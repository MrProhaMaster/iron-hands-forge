using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Assimp;
using Index.Profiles.SpaceMarine2.Common;
using Index.Profiles.SpaceMarine2.Meshes;
using LibSaber.IO;
using LibSaber.Serialization;
using LibSaber.SpaceMarine2.Serialization;
using LibSaber.SpaceMarine2.Structures;

namespace MedusaSiege.Extractor;
record ArchiveEntry(string Pak, string Entry, long Size, long CompressedSize);
record AssetExport(string asset,string raw,string metadata,int meshCount,int vertices,int faces,string[] cleanFiles,string selectionStatus,string transformValidation);
record AssemblyPreset(string id,string? template,string[] parts);
record TransformCheck(float maxBindMatrixError,float maxWeightSumError,bool finite);
class Program {
  static string game=""; static string output=""; static string dataRoot="";
  static readonly JsonSerializerOptions JsonOptions=new(){WriteIndented=true};
  static readonly Dictionary<string,List<ArchiveEntry>> Entries=new(StringComparer.OrdinalIgnoreCase);
  static readonly List<object> Inventory=new();
  static readonly List<AssemblyPreset> Presets=new();
  static bool PreserveRaw=false;
  static int Main(string[] args) {
    try {
      string? asset=null; bool inventoryOnly=false; bool batch=false; bool armorBatch=false; string format="glb2";
      for(int i=0;i<args.Length;i++) switch(args[i]) {
        case "--game": game=args[++i]; break;
        case "--data-root": dataRoot=args[++i]; break;
        case "--asset": asset=args[++i]; break;
        case "--out": output=args[++i]; break;
        case "--format": format=args[++i]; break;
        case "--inventory": inventoryOnly=true; break;
        case "--batch": batch=true; break;
        case "--armor-batch": armorBatch=true; break;
        case "--preserve-raw": PreserveRaw=true; break;
        default: throw new ArgumentException("Unknown argument: "+args[i]);
      }
      if(string.IsNullOrWhiteSpace(game)||string.IsNullOrWhiteSpace(output)||string.IsNullOrWhiteSpace(dataRoot)) throw new ArgumentException("--game PATH --data-root ROOT --out PATH [--inventory | --asset NAME] [--format glb2|fbx]");
      dataRoot=Path.GetFullPath(dataRoot);
      output=Path.GetFullPath(output);
      var relative=Path.GetRelativePath(dataRoot,output);
      if(relative==".."||relative.StartsWith(".."+Path.DirectorySeparatorChar)||Path.IsPathRooted(relative)) throw new ArgumentException("Output must stay inside the configured private data root");
      Directory.CreateDirectory(output); ReadPresets(); IndexArchives();
      var weapons=Entries.Where(x=>x.Key.StartsWith("wpn_",StringComparison.OrdinalIgnoreCase)&&x.Key.EndsWith(".tpl",StringComparison.OrdinalIgnoreCase))
        .OrderBy(x=>x.Key).Select(x=>new {name=Path.GetFileNameWithoutExtension(x.Key), entries=x.Value}).ToList();
      File.WriteAllText(Path.Combine(output,"weapons.json"),JsonSerializer.Serialize(new{game,indexedAt=DateTimeOffset.UtcNow,weaponTemplates=weapons},JsonOptions));
      Console.WriteLine($"Indexed {Entries.Count} unique template/resource filenames; {weapons.Count} weapon templates.");
      if(inventoryOnly) return 0;
      if(batch || armorBatch) {
        var names=armorBatch?Entries.Keys.Where(n=>n.StartsWith("cc_sm_constructor",StringComparison.OrdinalIgnoreCase)&&n.EndsWith(".tpl",StringComparison.OrdinalIgnoreCase)).Select(Path.GetFileNameWithoutExtension).Select(n=>n!).OrderBy(n=>n=="cc_sm_constructor_soldier"?0:1).ThenBy(n=>n).ToList():weapons.Where(w=>IsSpaceMarineWeapon(w.name)).OrderBy(w=>w.name.Contains("omnissian_power_axe_01_iron_hands")?0:1).ThenBy(w=>w.name).Select(w=>w.name).ToList();
        var completed=new List<AssetExport>(); var failures=new List<object>();
        void Manifest(bool done) {
          var temp=Path.Combine(output,"manifest.json.tmp");
          File.WriteAllText(temp,JsonSerializer.Serialize(new{schemaVersion=2,extractorVersion="5.0-skin-safe-three-weight",kind=armorBatch?"armor_constructors":"space_marine_weapons",completed=done,transformValidation=done&&completed.All(x=>x.transformValidation=="passed")?"passed":"pending",validationBasis="mesh_to_bone_bind_matrix_products;finite_geometry;normalized_weights;auto_bolt_rifle_official_reference_scale",game,output,updatedAt=DateTimeOffset.UtcNow,selected=names.Count,exported=completed.Count,failed=failures.Count,assets=completed,failures},JsonOptions));
          File.Move(temp,Path.Combine(output,"manifest.json"),true);
        }
        Manifest(false);
        foreach(var name in names) {
          try { var result=ExportAsset(name,format); completed.Add(result); Console.WriteLine($"OK {completed.Count}/{names.Count} {name} {result.vertices} vertices"); }
          catch(Exception ex) { failures.Add(new{asset=name,error=ex.ToString()}); Console.Error.WriteLine($"FAIL {name}: {ex.Message}"); }
          Manifest(false);
          if((completed.Count+failures.Count)%10==0) GC.Collect();
        }
        Manifest(true); return failures.Count==0?0:2;
      }
      if(asset is null) throw new ArgumentException("--asset is required to extract one template.");
      ExportAsset(asset,format); return 0;
    } catch(Exception e) { Console.Error.WriteLine(e); return 1; }
  }
  static bool IsSpaceMarineWeapon(string name) {
    if(Regex.IsMatch(name,@"chaos|rubric|tzaangor|helbrute|sorcerer|khopesh|fleshborer|venom_cannon|soulfire|force_stave|inferno_combibolter",RegexOptions.IgnoreCase)) return false;
    if(Regex.IsMatch(name,@"^wpn_(lasgun|machete|grenade_cadian|combat_stimulants)",RegexOptions.IgnoreCase)) return false;
    return true;
  }
  static void ReadPresets() {
    var path=Path.Combine(dataRoot,"tools","sm2-extractor","metadata","skins-regions.json");
    if(!File.Exists(path)) return;
    using var doc=JsonDocument.Parse(File.ReadAllText(path));
    if(!doc.RootElement.TryGetProperty("skins",out var skins)) return;
    foreach(var skin in skins.EnumerateArray()) {
      string ReadString(params string[] keys) {
        foreach(var key in keys) if(skin.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String) return v.GetString()??"";
        return "";
      }
      var uid=ReadString("firearmUid","weaponUid","meleeUid","uid"); var skinId=ReadString("skinId","id");
      var template=ReadString("template","templateName");
      if((skin.TryGetProperty("resolvedMeshNames",out var parts)&&parts.ValueKind==JsonValueKind.Array&&parts.GetArrayLength()>0)
        || (skin.TryGetProperty("defaultRegionMeshNames",out parts)&&parts.ValueKind==JsonValueKind.Array)) {
        var names=parts.EnumerateArray().Where(x=>x.ValueKind==JsonValueKind.String).Select(x=>x.GetString()!).Distinct().ToArray();
        if(names.Length>0) Presets.Add(new(uid+"__"+skinId,string.IsNullOrWhiteSpace(template)?null:Path.GetFileNameWithoutExtension(template),names));
      }
    }
    Console.WriteLine($"Loaded {Presets.Count} assembly presets.");
  }
  static bool IsServiceMesh(Mesh mesh) {
    var n=mesh.Name;
    if(Regex.IsMatch(n,@"^(rb_|cdt_|col_|collision_)|_glr($|_)|flame_area|shells_source|_dropped$|_glow|_power_idle|_charge|muzzle|sfx|vfx",RegexOptions.IgnoreCase)) return true;
    return false;
  }
  static Scene SelectMeshes(Scene source,HashSet<int> selected) {
    var scene=new Scene(); foreach(var material in source.Materials) scene.Materials.Add(material);
    var mapping=new Dictionary<int,int>();
    foreach(var index in selected.Order()) {mapping[index]=scene.Meshes.Count;scene.Meshes.Add(source.Meshes[index]);}
    Node Copy(Node node,Node? parent) {
      var target=new Node(node.Name,parent){Transform=node.Transform};
      foreach(var index in node.MeshIndices) if(mapping.TryGetValue(index,out var mapped)) target.MeshIndices.Add(mapped);
      foreach(var child in node.Children) target.Children.Add(Copy(child,target));
      return target;
    }
    scene.RootNode=Copy(source.RootNode,null); return scene;
  }
  static void IndexArchives() {
    var root=Path.Combine(game,"client_pc","root","paks","client");
    var paks=Directory.EnumerateFiles(Path.Combine(root,"default"),"default_tpl*.pak").OrderBy(x=>x).ToList();
    paks.Add(Path.Combine(root,"resources.pak"));
    foreach(var pak in paks) {
      using var zip=ZipFile.OpenRead(pak);
      foreach(var entry in zip.Entries) {
        var name=Path.GetFileName(entry.FullName.Replace('\\','/'));
        if(!(name.EndsWith(".tpl",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".tpl_data",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".tpl.resource",StringComparison.OrdinalIgnoreCase))) continue;
        if(!Entries.TryGetValue(name,out var matches)) Entries[name]=matches=new();
        matches.Add(new(pak,entry.FullName,entry.Length,entry.CompressedLength));
      }
    }
  }
  static MemoryStream ReadEntry(ArchiveEntry source) {
    using var zip=ZipFile.OpenRead(source.Pak);
    var entry=zip.GetEntry(source.Entry)??throw new FileNotFoundException(source.Entry);
    var memory=new MemoryStream(checked((int)entry.Length));
    using(var stream=entry.Open()) stream.CopyTo(memory);
    memory.Position=0; return memory;
  }
  static ArchiveEntry Find(string name) {
    if(!Entries.TryGetValue(name,out var files)) throw new FileNotFoundException("Entry not found: "+name);
    if(files.Count!=1) Console.WriteLine($"Warning: {files.Count} entries for {name}; taking {files[0].Pak}");
    return files[0];
  }
  static AssetExport ExportAsset(string asset,string format) {
    asset=Path.GetFileNameWithoutExtension(asset);
    var templateSource=Find(asset+".tpl");
    using var tplStream=ReadEntry(templateSource);
    var reader=new NativeReader(tplStream,Endianness.LittleEndian);
    var template=Serializer<animTPL>.Deserialize(reader,new SerializationContext());
    var dataName=asset+".tpl_data";
    if(Entries.TryGetValue(asset+".tpl.resource",out var resources)) {
      using var resourceStream=ReadEntry(resources[0]); using var text=new StreamReader(resourceStream);
      var resourceText=text.ReadToEnd();
      var match=Regex.Match(resourceText,@"(?m)^tplData:\s*['"" ]?([^\r\n'"" ]+)");
      if(match.Success && !string.IsNullOrWhiteSpace(match.Groups[1].Value)) dataName=Path.GetFileName(match.Groups[1].Value);
      File.WriteAllText(Path.Combine(output,asset+".tpl.resource.txt"),resourceText);
    }
    using var dataStream=Entries.ContainsKey(dataName)?ReadEntry(Find(dataName)):ReadEntry(templateSource);
    var context=new SceneContext(asset,template.GeometryGraph,dataStream);
    var lodMap=(template.lodDef??new()).GroupBy(x=>x.objId).ToDictionary(x=>x.Key,x=>x.Min(y=>y.index));
    int LodFor(objOBJ obj) {
      for(var p=obj;p!=null;p=p.Parent) if(lodMap.TryGetValue(p.id,out var lod)) return lod;
      var m=Regex.Match(obj.GetName()??"",@"_lod([1-9]\d*)$",RegexOptions.IgnoreCase);
      return m.Success?int.Parse(m.Groups[1].Value):0;
    }
    void AddNodes(objOBJ obj,Node parent) {
      if(obj.SubMeshes.Any()) return;
      var name=obj.GetName()??("node_"+obj.id);
      var node=new Node(name,parent); parent.Children.Add(node); context.Nodes[obj.id]=node; context.NodeNames[name]=node;
      var transform=obj.MatrixModel.ToAssimp(); transform.Transpose(); node.Transform=transform;
      foreach(var child in obj.EnumerateChildren()) AddNodes(child,node);
    }
    AddNodes(context.GeometryGraph.RootObject,context.RootNode);
    var meshReports=new List<object>();
    var meshObjects=new Dictionary<int,objOBJ>();
    var profileNames=new List<string>();
    var profileNameIds=new Dictionary<string,int>(StringComparer.Ordinal);
    var profilePath=Path.Combine(output,asset+".skin_profiles.bin");
    using var profileStream=new FileStream(profilePath,FileMode.Create,FileAccess.Write,FileShare.Read);
    foreach(var obj in context.GeometryGraph.objects.Where(x=>x.SubMeshes.Any())) {
      if(LodFor(obj)>0) continue;
      foreach(var submesh in obj.SubMeshes) {
        var node=new Node(obj.GetName()??("mesh_"+obj.id),context.RootNode); context.RootNode.Children.Add(node);
        var builder=new MeshBuilder(context,obj,submesh); var mesh=builder.Build();
        if(mesh.VertexCount==0||mesh.FaceCount==0) {context.RootNode.Children.Remove(node);continue;}
        context.Scene.Meshes.Add(mesh); node.MeshIndices.Add(context.Scene.Meshes.Count-1);
        meshObjects[context.Scene.Meshes.Count-1]=obj;
        var transform=obj.MatrixLT.ToAssimp(); transform.Transpose(); node.Transform=transform;
        if(!mesh.HasBones&&obj.Parent!=null) builder.ParentMeshToBone(obj.Parent);
        NormalizeWeights(mesh);
        var skinProfileAudit=WriteSkinProfileAuditAndProtectVertices(mesh,profileStream,profileNames,profileNameIds);
        meshReports.Add(new{name=obj.GetName(),objectId=obj.id,lod=LodFor(obj),vertices=mesh.VertexCount,faces=mesh.FaceCount,bones=mesh.BoneCount,material=context.Scene.Materials[mesh.MaterialIndex].Name,
          skinProfileAudit,
          vertexBounds=new[]{new[]{mesh.Vertices.Min(v=>v.X),mesh.Vertices.Min(v=>v.Y),mesh.Vertices.Min(v=>v.Z)},new[]{mesh.Vertices.Max(v=>v.X),mesh.Vertices.Max(v=>v.Y),mesh.Vertices.Max(v=>v.Z)}},
          quantizationScale=submesh.Scale.HasValue?new[]{submesh.Scale.Value.X,submesh.Scale.Value.Y,submesh.Scale.Value.Z}:null,
          quantizationOffset=submesh.Position.HasValue?new[]{submesh.Position.Value.X,submesh.Position.Value.Y,submesh.Position.Value.Z}:null,
          matrixLT=new[]{obj.MatrixLT.M11,obj.MatrixLT.M12,obj.MatrixLT.M13,obj.MatrixLT.M14,obj.MatrixLT.M21,obj.MatrixLT.M22,obj.MatrixLT.M23,obj.MatrixLT.M24,obj.MatrixLT.M31,obj.MatrixLT.M32,obj.MatrixLT.M33,obj.MatrixLT.M34,obj.MatrixLT.M41,obj.MatrixLT.M42,obj.MatrixLT.M43,obj.MatrixLT.M44},
          matrixModel=new[]{obj.MatrixModel.M11,obj.MatrixModel.M12,obj.MatrixModel.M13,obj.MatrixModel.M14,obj.MatrixModel.M21,obj.MatrixModel.M22,obj.MatrixModel.M23,obj.MatrixModel.M24,obj.MatrixModel.M31,obj.MatrixModel.M32,obj.MatrixModel.M33,obj.MatrixModel.M34,obj.MatrixModel.M41,obj.MatrixModel.M42,obj.MatrixModel.M43,obj.MatrixModel.M44}});
      }
    }
    using var exporter=new AssimpContext();
    var bindValidation=ValidateTransforms(context,meshObjects);
    if(bindValidation.maxBindMatrixError>0.01 || bindValidation.maxWeightSumError>0.001 || !bindValidation.finite) throw new InvalidDataException("Transform validation failed: "+JsonSerializer.Serialize(bindValidation));
    var extension=format=="glb2"?"glb":format=="gltf2"?"gltf":format;
    var file=Path.Combine(output,asset+"."+extension);
    if(!PreserveRaw || !File.Exists(file)) if(!exporter.ExportFile(context.Scene,file,format)) throw new IOException("Assimp export failed: "+file);
    var candidates=new List<object>(); var cleanFiles=new List<string>(); var selectionStatus="heuristic_requires_review";
    var allNames=context.GeometryGraph.objects.Select(m=>m.GetName()).ToHashSet(StringComparer.OrdinalIgnoreCase);
    var matching=Presets.Where(p=>p.template==asset).Where(p=>p.parts.All(allNames.Contains)).ToList();
    if(matching.Count==0) matching=Presets.Where(p=>p.template is null && p.parts.Length>=4 && p.parts.All(allNames.Contains)).ToList();
    // Exact gameplay region presets are retained as separate assemblies. The raw file always preserves all LOD0 parts.
    HashSet<int> ResolveParts(AssemblyPreset preset) {
      var partNames=preset.parts.ToHashSet(StringComparer.OrdinalIgnoreCase); var selected=new HashSet<int>();
      foreach(var pair in meshObjects) {
        var mesh=context.Scene.Meshes[pair.Key];
        if(IsServiceMesh(mesh)||context.Scene.Materials[mesh.MaterialIndex].Name=="_"||context.Scene.Materials[mesh.MaterialIndex].Name.Contains("white_simple",StringComparison.OrdinalIgnoreCase)) continue;
        var visited=new HashSet<short>();
        for(var obj=pair.Value;obj!=null&&visited.Add(obj.id);obj=obj.Parent) if(partNames.Contains(obj.GetName())) {selected.Add(pair.Key);break;}
      }
      return selected;
    }
    var unique=matching.Select(p=>(preset:p,indices:ResolveParts(p))).Where(x=>x.indices.Count>0)
      .GroupBy(x=>string.Join("|",x.indices.Order())).Select(g=>g.First()).ToList();
    if(unique.Count>0) selectionStatus=unique.All(p=>p.preset.template==asset)?"retail_skin_regions":"retail_skin_regions_matched_by_meshes";
    if(asset.StartsWith("cc_sm_constructor")) selectionStatus="constructor_raw_all_LOD0_parts_separate_class";
    else if(unique.Count==0) {
      var defaults=context.Scene.Meshes.Select((m,i)=>(m,i)).Where(x=>!IsServiceMesh(x.m))
        .Where(x=>!context.Scene.Materials[x.m.MaterialIndex].Name.Contains("white_simple",StringComparison.OrdinalIgnoreCase))
        .Where(x=>context.Scene.Materials[x.m.MaterialIndex].Name!="_").Select(x=>x.i).ToHashSet();
      if(defaults.Count==1) selectionStatus="single_render_mesh";
      if(defaults.Count>0) {
        var cleanDir=Path.Combine(output,"clean");Directory.CreateDirectory(cleanDir);
        var cleanFile=Path.Combine(cleanDir,asset+".glb");
        if(!exporter.ExportFile(SelectMeshes(context.Scene,defaults),cleanFile,"glb2")) throw new IOException("Clean export failed");
        cleanFiles.Add(cleanFile); candidates.Add(new{id="default",file=cleanFile,selection=selectionStatus,parts=defaults.Select(i=>context.Scene.Meshes[i].Name)});
      }
    } else foreach(var assembly in unique) {
      var preset=assembly.preset; var selected=assembly.indices;
      var cleanDir=Path.Combine(output,"clean");Directory.CreateDirectory(cleanDir);
      var safeId=Regex.Replace(preset.id,@"[^A-Za-z0-9_-]","_");
      var cleanFile=Path.Combine(cleanDir,asset+"__"+safeId+".glb");
      if(!exporter.ExportFile(SelectMeshes(context.Scene,selected),cleanFile,"glb2")) throw new IOException("Clean assembly export failed");
      cleanFiles.Add(cleanFile); candidates.Add(new{id=preset.id,file=cleanFile,selection=selectionStatus,parts=preset.parts});
    }
    var objectMetadata=template.GeometryGraph.objects.Select(obj=>new{
      id=obj.id,parentId=obj.parentId,name=obj.GetName(),fullPath=obj.UnkName,readName=obj.ReadName,
      readOnlyName=obj.ReadOnlyObjectName,sourceId=obj.SourceId,affixes=obj.Affixes,readAffixes=obj.ReadAffixes,
      ps=obj.ps,lod=LodFor(obj),submeshes=obj.SubMeshes.Select(s=>new{s.MeshId,s.NodeId,vertices=s.BufferInfo.VertexCount,faces=s.BufferInfo.FaceCount,material=s.Material?.MaterialName,texture=s.Material?.ShadingMaterialTexture})
    });
    profileStream.Flush(true);
    var report=new {asset,extractorVersion="5.0-skin-safe-three-weight",transformValidation="passed",bindValidation,templateSource,dataName,objects=template.GeometryGraph.objects.Count,sourceSubmeshes=template.GeometryGraph.SubMeshes.Count,meshCount=context.Scene.MeshCount,vertices=context.Scene.Meshes.Sum(x=>x.VertexCount),faces=context.Scene.Meshes.Sum(x=>x.FaceCount),materials=context.Scene.Materials.Select(x=>x.Name),textures=template.TexList,meshes=meshReports,skinProfileAuditFile=profilePath,skinProfileBoneNames=profileNames,skinProfileAuditFormat="little-endian float32[vertexCount,6]: boneNameIndex0,weight0,boneNameIndex1,weight1,boneNameIndex2,weight2",lodDefinitions=template.lodDef,lodRoots=template.GeometryGraph.lodRoots,objectMetadata,assemblies=candidates,selectionStatus,file};
    File.WriteAllText(Path.Combine(output,asset+".json"),JsonSerializer.Serialize(report,JsonOptions));
    var summary=new AssetExport(asset,file,Path.Combine(output,asset+".json"),context.Scene.MeshCount,context.Scene.Meshes.Sum(x=>x.VertexCount),context.Scene.Meshes.Sum(x=>x.FaceCount),cleanFiles.ToArray(),selectionStatus,"passed");
    return summary;
  }
  static TransformCheck ValidateTransforms(SceneContext context,Dictionary<int,objOBJ> meshObjects) {
    var bones=context.GeometryGraph.objects.GroupBy(x=>x.GetName()).ToDictionary(x=>x.Key,x=>x.ToArray());
    float maxBind=0,maxWeight=0; bool finite=true;
    float[] Values(System.Numerics.Matrix4x4 m)=>new[]{m.M11,m.M12,m.M13,m.M14,m.M21,m.M22,m.M23,m.M24,m.M31,m.M32,m.M33,m.M34,m.M41,m.M42,m.M43,m.M44};
    foreach(var pair in meshObjects) {
      var mesh=context.Scene.Meshes[pair.Key]; var totals=new float[mesh.VertexCount];
      foreach(var v in mesh.Vertices) if(!float.IsFinite(v.X)||!float.IsFinite(v.Y)||!float.IsFinite(v.Z)) finite=false;
      foreach(var bone in mesh.Bones) {
        foreach(var w in bone.VertexWeights) totals[w.VertexID]+=w.Weight;
        if(!bones.TryGetValue(bone.Name,out var candidates)) {finite=false;continue;}
        var offset=System.Numerics.Matrix4x4.Transpose(bone.OffsetMatrix.ToNumerics());
        var expected=Values(pair.Value.MatrixLT);
        var error=candidates.Min(boneObj=>Values(offset*boneObj.MatrixLT).Zip(expected,(actualValue,expectedValue)=>Math.Abs(actualValue-expectedValue)).Max());
        maxBind=Math.Max(maxBind,error); if(!float.IsFinite(error)) finite=false;
      }
      foreach(var total in totals) if(total>0) maxWeight=Math.Max(maxWeight,Math.Abs(total-1));
    }
    return new(maxBind,maxWeight,finite);
  }
  static void NormalizeWeights(Mesh mesh) {
    foreach(var bone in mesh.Bones) {
      var combined=bone.VertexWeights.GroupBy(w=>w.VertexID).Select(g=>new VertexWeight(g.Key,g.Sum(w=>w.Weight))).ToArray();
      bone.VertexWeights.Clear(); bone.VertexWeights.AddRange(combined);
    }
    var totals=new float[mesh.VertexCount];
    foreach(var bone in mesh.Bones) foreach(var weight in bone.VertexWeights) totals[weight.VertexID]+=weight.Weight;
    foreach(var bone in mesh.Bones) for(int i=0;i<bone.VertexWeights.Count;i++) {
      var weight=bone.VertexWeights[i]; if(totals[weight.VertexID]>0) bone.VertexWeights[i]=new VertexWeight(weight.VertexID,weight.Weight/totals[weight.VertexID]);
    }
  }
  static object WriteSkinProfileAuditAndProtectVertices(Mesh mesh,FileStream stream,List<string> names,Dictionary<string,int> nameIds) {
    if(mesh.VertexCount>=1<<24) throw new InvalidDataException("UV0 source vertex guard exceeds exact float integer range");
    if(mesh.TextureCoordinateChannels[7].Count>0) throw new InvalidDataException("All eight UV channels are occupied; cannot preserve source UVs while adding the export guard");
    var records=new float[checked(mesh.VertexCount*6)];
    var counts=new byte[mesh.VertexCount];
    foreach(var bone in mesh.Bones) {
      if(!nameIds.TryGetValue(bone.Name,out var id)) {id=names.Count;nameIds.Add(bone.Name,id);names.Add(bone.Name);}
      foreach(var weight in bone.VertexWeights) {
        if(weight.Weight<=0) continue;
        int slot=counts[weight.VertexID]++;
        if(slot>=3) throw new InvalidDataException("Validated WEIGHT4 source produced more than three actual influences");
        records[weight.VertexID*6+slot*2]=id;
        records[weight.VertexID*6+slot*2+1]=weight.Weight;
      }
    }
    long offset=stream.Position;
    stream.Write(MemoryMarshal.AsBytes(records.AsSpan()));
    var used=new HashSet<int>();
    using var faceHash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    Span<byte> indexBytes=stackalloc byte[4];
    foreach(var face in mesh.Faces) foreach(int index in face.Indices) {
      used.Add(index);
      System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(indexBytes,index);
      faceHash.AppendData(indexBytes);
    }
    int originalUVChannels=0;
    for(int i=0;i<8;i++) if(mesh.TextureCoordinateChannels[i].Count>0) originalUVChannels=i+1;
    for(int i=0;i<originalUVChannels;i++) if(mesh.TextureCoordinateChannels[i].Count!=mesh.VertexCount) throw new InvalidDataException("Sparse/incomplete UV channels are unsupported for a reversible guard");
    for(int i=7;i>=1;i--) {
      mesh.TextureCoordinateChannels[i].Clear();
      mesh.TextureCoordinateChannels[i].AddRange(mesh.TextureCoordinateChannels[i-1]);
      mesh.UVComponentCount[i]=mesh.UVComponentCount[i-1];
    }
    mesh.TextureCoordinateChannels[0].Clear();
    mesh.UVComponentCount[0]=2;
    for(int i=0;i<mesh.VertexCount;i++) mesh.TextureCoordinateChannels[0].Add(new Vector3D(i,0,0));
    return new {byteOffset=offset,vertexCount=mesh.VertexCount,recordStride=24,sourceUsedVertexCount=used.Count,sourceUnusedVertexCount=mesh.VertexCount-used.Count,faceSourceIndexSha256=Convert.ToHexString(faceHash.GetHashAndReset()).ToLowerInvariant(),originalUVChannels,guard="UV0=(exact source vertex ID,0); original UV channels shifted +1; restore labels after export"};
  }
}

