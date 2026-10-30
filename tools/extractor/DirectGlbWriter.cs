using System.Text.Json;
using Assimp;
using NMatrix=System.Numerics.Matrix4x4;

namespace MedusaSiege.Extractor;

/// <summary>Own streaming glTF writer. Keeps source vertices, full skin palettes and UV guards.</summary>
static class DirectGlbWriter {
 static float[] Matrix(Assimp.Matrix4x4 m)=>new[]{m.A1,m.B1,m.C1,m.D1,m.A2,m.B2,m.C2,m.D2,m.A3,m.B3,m.C3,m.D3,m.A4,m.B4,m.C4,m.D4};
 static NMatrix Numeric(Assimp.Matrix4x4 m)=>new(m.A1,m.A2,m.A3,m.A4,m.B1,m.B2,m.B3,m.B4,m.C1,m.C2,m.C3,m.C4,m.D1,m.D2,m.D3,m.D4);
 static float[] Values(NMatrix m)=>new[]{m.M11,m.M12,m.M13,m.M14,m.M21,m.M22,m.M23,m.M24,m.M31,m.M32,m.M33,m.M34,m.M41,m.M42,m.M43,m.M44};
 public static void Write(Scene scene,string file) {
  var nodes=new List<Dictionary<string,object>>();var sourceNodes=new List<Node>();var world=new List<NMatrix>();var byName=new Dictionary<string,List<int>>(StringComparer.Ordinal);var meshNode=new Dictionary<int,int>();
  int AddNode(Node node,NMatrix parent) {
   int index=nodes.Count;var value=new Dictionary<string,object>{{"name",node.Name},{"matrix",Matrix(node.Transform)}};nodes.Add(value);sourceNodes.Add(node);world.Add(parent*Numeric(node.Transform));
   if(!byName.TryGetValue(node.Name,out var list))byName[node.Name]=list=new();list.Add(index);
   if(node.MeshCount>1)throw new InvalidDataException("Multiple meshes on one native node");
   if(node.MeshCount==1){int mi=node.MeshIndices[0];value["mesh"]=mi;if(!meshNode.TryAdd(mi,index))throw new InvalidDataException("A native mesh is instanced");}
   if(node.ChildCount>0)value["children"]=node.Children.Select(c=>AddNode(c,world[index])).ToArray();return index;
  }
  int root=AddNode(scene.RootNode,NMatrix.Identity);
  var views=new List<Dictionary<string,object>>();var accessors=new List<Dictionary<string,object>>();var meshes=new List<object>();var skins=new List<object>();
  var binaryFile=file+".binary-tmp";using(var stream=new FileStream(binaryFile,FileMode.Create,FileAccess.ReadWrite,FileShare.None))using(var writer=new BinaryWriter(stream)) {
   int Accessor(Action<BinaryWriter> write,int count,string type,int component,int? target=null,float[]? min=null,float[]? max=null) {
    while(stream.Position%4!=0)writer.Write((byte)0);long offset=stream.Position;write(writer);long length=stream.Position-offset;
    int vi=views.Count;var view=new Dictionary<string,object>{{"buffer",0},{"byteOffset",offset},{"byteLength",length}};if(target is not null)view["target"]=target.Value;views.Add(view);
    var a=new Dictionary<string,object>{{"bufferView",vi},{"componentType",component},{"count",count},{"type",type}};if(min is not null)a["min"]=min;if(max is not null)a["max"]=max;int result=accessors.Count;accessors.Add(a);return result;
   }
   for(int mi=0;mi<scene.MeshCount;mi++) {
    var m=scene.Meshes[mi];var used=m.Faces.SelectMany(f=>f.Indices).Distinct().Order().ToArray();var map=Enumerable.Repeat(-1,m.VertexCount).ToArray();for(int v=0;v<used.Length;v++)map[used[v]]=v;
    if(used.Length==0||m.Faces.Any(f=>f.IndexCount!=3))throw new InvalidDataException("Native triangle topology required");
    var attrs=new Dictionary<string,int>();
    attrs["POSITION"]=Accessor(w=>{foreach(int i in used){var v=m.Vertices[i];w.Write(v.X);w.Write(v.Y);w.Write(v.Z);}},used.Length,"VEC3",5126,34962,new[]{used.Min(i=>m.Vertices[i].X),used.Min(i=>m.Vertices[i].Y),used.Min(i=>m.Vertices[i].Z)},new[]{used.Max(i=>m.Vertices[i].X),used.Max(i=>m.Vertices[i].Y),used.Max(i=>m.Vertices[i].Z)});
    if(m.Normals.Count==m.VertexCount)attrs["NORMAL"]=Accessor(w=>{foreach(int i in used){var v=m.Normals[i];w.Write(v.X);w.Write(v.Y);w.Write(v.Z);}},used.Length,"VEC3",5126,34962);
    if(m.Tangents.Count==m.VertexCount&&m.BiTangents.Count==m.VertexCount&&m.Normals.Count==m.VertexCount)attrs["TANGENT"]=Accessor(w=>{foreach(int i in used){var v=m.Tangents[i];var n=m.Normals[i];var b=m.BiTangents[i];float sign=((n.Y*v.Z-n.Z*v.Y)*b.X+(n.Z*v.X-n.X*v.Z)*b.Y+(n.X*v.Y-n.Y*v.X)*b.Z)<0?-1:1;w.Write(v.X);w.Write(v.Y);w.Write(v.Z);w.Write(sign);}},used.Length,"VEC4",5126,34962);
    for(int uv=0;uv<8;uv++){int channel=uv;if(m.TextureCoordinateChannels[channel].Count==m.VertexCount)attrs["TEXCOORD_"+channel]=Accessor(w=>{foreach(int i in used){var v=m.TextureCoordinateChannels[channel][i];w.Write(v.X);w.Write(1-v.Y);}},used.Length,"VEC2",5126,34962);}
    for(int color=0;color<8;color++){int channel=color;if(m.VertexColorChannels[channel].Count==m.VertexCount)attrs["COLOR_"+channel]=Accessor(w=>{foreach(int i in used){var c=m.VertexColorChannels[channel][i];w.Write(c.R);w.Write(c.G);w.Write(c.B);w.Write(c.A);}},used.Length,"VEC4",5126,34962);}
    if(!m.HasBones)throw new InvalidDataException("Unskinned source mesh");
    if(m.BoneCount>65536||m.Bones.Select(b=>b.Name).Distinct().Count()!=m.BoneCount)throw new InvalidDataException("Invalid native bone palette");
    var joints=new int[m.BoneCount];var offsets=new float[m.BoneCount][];
    for(int bi=0;bi<m.BoneCount;bi++){
     var bone=m.Bones[bi];if(!byName.TryGetValue(bone.Name,out var candidates))throw new InvalidDataException("Missing native bone: "+bone.Name);
     var expected=Values(world[meshNode[mi]]);var offset=Numeric(bone.OffsetMatrix);
     int best=-1;float error=float.PositiveInfinity;
     foreach(int ni in candidates){var actual=Values(world[ni]*offset);float e=actual.Zip(expected,(a,b)=>Math.Abs(a-b)).Max();if(e<error){error=e;best=ni;}}
     if(best<0||error>.01f)throw new InvalidDataException("Native bone bind mismatch: "+bone.Name+" "+error);
     joints[bi]=best;offsets[bi]=Matrix(bone.OffsetMatrix);
    }
    var counts=new int[m.VertexCount];foreach(var b in m.Bones)foreach(var weight in b.VertexWeights)if(weight.Weight>0)counts[weight.VertexID]++;
    int width=counts.Max()<=3?4:8;if(counts.Max()>8)throw new InvalidDataException("Source has >8 influences");
    var indices=new ushort[used.Length*width];var weights=new float[used.Length*width];var fill=new int[used.Length];
    for(int bi=0;bi<m.BoneCount;bi++)foreach(var vw in m.Bones[bi].VertexWeights){if(vw.Weight<=0||map[vw.VertexID]<0)continue;int v=map[vw.VertexID],at=v*width+fill[v]++;indices[at]=(ushort)bi;weights[at]=vw.Weight;}
    for(int set=0;set<width/4;set++){int start=set*4;attrs["JOINTS_"+set]=Accessor(w=>{for(int v=0;v<used.Length;v++)for(int c=0;c<4;c++)w.Write(indices[v*width+start+c]);},used.Length,"VEC4",5123,34962);attrs["WEIGHTS_"+set]=Accessor(w=>{for(int v=0;v<used.Length;v++)for(int c=0;c<4;c++)w.Write(weights[v*width+start+c]);},used.Length,"VEC4",5126,34962);}
    int ibm=Accessor(w=>{foreach(var matrix in offsets)foreach(float value in matrix)w.Write(value);},m.BoneCount,"MAT4",5126);
    int skin=skins.Count;skins.Add(new{joints,inverseBindMatrices=ibm,skeleton=root});nodes[meshNode[mi]]["skin"]=skin;
    int faces=Accessor(w=>{foreach(var f in m.Faces)foreach(int index in f.Indices)w.Write((uint)map[index]);},m.FaceCount*3,"SCALAR",5125,34963);
    meshes.Add(new{name=m.Name,primitives=new[]{new{attributes=attrs,indices=faces,material=m.MaterialIndex,mode=4}}});
    if(mi%100==0)Console.WriteLine($"DIRECT_GLB_MESH {mi}/{scene.MeshCount} bytes={stream.Position}");
   }
   while(stream.Position%4!=0)writer.Write((byte)0);writer.Flush();long binLength=stream.Length;
   var materials=scene.Materials.Select(m=>new{name=m.Name,pbrMetallicRoughness=new{baseColorFactor=new[]{1f,1f,1f,1f},metallicFactor=0f,roughnessFactor=1f},doubleSided=true}).ToArray();
   var doc=new{asset=new{version="2.0",generator="Iron Hands Forge direct native writer v1"},scene=0,scenes=new[]{new{nodes=new[]{root}}},nodes,meshes,skins,materials,buffers=new[]{new{byteLength=binLength}},bufferViews=views,accessors};
   byte[] json=JsonSerializer.SerializeToUtf8Bytes(doc);int pad=(-json.Length)&3;long total=28L+json.Length+pad+binLength;
   if(total>uint.MaxValue)throw new InvalidDataException("Native GLB exceeds 4GiB");
   using var output=new FileStream(file,FileMode.Create,FileAccess.Write,FileShare.None);using var final=new BinaryWriter(output);
   final.Write(0x46546c67u);final.Write(2u);final.Write((uint)total);final.Write((uint)(json.Length+pad));final.Write(0x4e4f534au);final.Write(json);for(int i=0;i<pad;i++)final.Write((byte)32);final.Write((uint)binLength);final.Write(0x004e4942u);stream.Position=0;stream.CopyTo(output);final.Flush();
  }
  File.Delete(binaryFile);
 }
}
