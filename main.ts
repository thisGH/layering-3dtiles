const fs = require("fs");
const path = require("path");
const gltfPipeline = require("gltf-pipeline");
const fsExtra = require("fs-extra");
const pino = require("pino");
const { NodeIO } = require("@gltf-transform/core");
const {
  weld,
  simplify,
  textureCompress,
} = require("@gltf-transform/functions");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { MeshoptSimplifier } = require("meshoptimizer");
const draco3d = require("draco3dgltf");
const sharp = require("sharp");

// 创建一个可写流到文件
const stream = fs.createWriteStream("./my-log.json");
// 配置 Pino 使用这个流
const logger = pino(stream);

const filePath = "3dtiles-test2";

// 读取3D Tiles数据
const tilesData = fs.readFileSync(
  path.join(__dirname, filePath, "tileset.json"),
  "utf-8"
);
const tiles = JSON.parse(tilesData);

fsExtra.emptyDirSync(path.join(__dirname, "output"));
fsExtra.mkdirsSync(path.join(__dirname, "output", "origin-glb"));
fsExtra.mkdirsSync(path.join(__dirname, "output", "gltf"));
fsExtra.mkdirsSync(path.join(__dirname, "output", "compressed-glb"));
fsExtra.mkdirsSync(path.join(__dirname, "output", "reduceface-glb"));

const dracoOptions = {
  compressionLevel: 10, // 压缩级别，可调整
};
const options = {
  dracoOptions: dracoOptions,
  compressMeshes: true,
};

const main = async () => {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(), // Optional.
      "draco3d.encoder": await draco3d.createEncoderModule(), // Optional.
    });

  const traverse = (children: any) => {
    // 遍历每个tile
    children.forEach(async (tile, index) => {
      // 检查是否存在GLB模型
      if (
        tile.content &&
        tile.content.uri &&
        tile.content.uri.endsWith(".b3dm")
      ) {
        const b3dmPath = path.join(__dirname, filePath, tile.content.uri);
        const b3dmData = fs.readFileSync(b3dmPath);

        const data = extractB3dm(b3dmData);

        const glb = data.glb;

        fsExtra.outputFileSync(
          path.join(
            __dirname,
            "output",
            "origin-glb",
            `${tile.content.uri}.glb`
          ),
          glb
        );

        const document = await io.readBinary(glb);
        await reduceFace(document, tile.content.uri);
        const reduceFaceGlb = await io.writeBinary(document);
        fsExtra.outputFileSync(
          path.join(
            __dirname,
            "output",
            "reduceface-glb",
            `${tile.content.uri}.glb`
          ),
          reduceFaceGlb
        );

        gltfPipeline
          .glbToGltf(glb)
          .then(function (results) {
            if (
              results.gltf.extensionsRequired.some(
                (item) => item === "KHR_draco_mesh_compression"
              )
            ) {
              console.log(`${index}序号为draco glb`);
            }

            fsExtra.outputJsonSync(
              path.join(
                __dirname,
                "output",
                "gltf",
                `${tile.content.uri}.gltf`
              ),
              results.gltf
            );
          })
          .catch((error) => {
            console.error("Error:", error);
          });

        gltfPipeline
          .processGltf(glb, options)
          .then(function (results) {
            fsExtra.outputFileSync(
              path.join(
                __dirname,
                "output",
                "compressed-glb",
                `${tile.content.uri}.glb`
              ),
              results.gltf
            );
          })
          .catch((error) => {
            console.error("Error:", error);
          });
        // 应用Draco几何压缩
      }

      traverse(tile.children);
    });
  };

  traverse(tiles.root.children);
};

main();

async function reduceFace(document, uri) {
  // 减面需要这2个主要参数，ratio是减面率，越低减面效果越好，error是误差率，越高，外观变形越严重
  const ratio = 0.75;
  const error = 0.001;

  //开始减面，我们拿上传读取出来的document，进行减面
  // weld主要是对顶点进行优化，尽可能提高减面质量
  await document.transform(
    weld({ tolerance: 0.0001 }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: ratio,
      error,
    })
  );

  await document.transform(
    textureCompress({
      encoder: sharp,
      //最大纹理宽高，并保留纹理的宽高比
      resize: [1024, 1024],
      //纹理压缩质量，范围是1-100，可以不传
      quality: 50,
    })
  );
}

// logger.info({
//   tiles: resTiles,
// });

function getMagic(tileBuffer) {
  const byteOffset = 0;
  return tileBuffer.toString("utf8", byteOffset, byteOffset + 4);
}
function alignGlb(buffer, byteOffset) {
  // The glb may not be aligned to an 8-byte boundary within the tile, causing gltf-pipeline operations to fail.
  // If unaligned, copy the glb to a new buffer.
  if (byteOffset % 8 === 0) {
    return buffer;
  }
  return Buffer.from(buffer);
}
function bufferToJson(buffer) {
  if (buffer.length === 0) {
    return {};
  }
  return JSON.parse(buffer.toString());
}

function extractB3dm(b3dmBuffer: Buffer) {
  if (!b3dmBuffer) {
    throw "b3dmBuffer is not defined.";
  }
  var magic = getMagic(b3dmBuffer);
  if (magic !== "b3dm") {
    throw 'Invalid magic, expected "b3dm", got: "' + magic + '".';
  }
  var version = b3dmBuffer.readUInt32LE(4);
  if (version !== 1) {
    throw 'Invalid version, only "1" is valid, got: "' + version + '".';
  }
  var headerByteLength = 28;
  var byteLength = b3dmBuffer.readUInt32LE(8);
  var featureTableJsonByteLength = b3dmBuffer.readUInt32LE(12);
  var featureTableBinaryByteLength = b3dmBuffer.readUInt32LE(16);
  var batchTableJsonByteLength = b3dmBuffer.readUInt32LE(20);
  var batchTableBinaryByteLength = b3dmBuffer.readUInt32LE(24);
  var batchLength = 0;

  // Keep this legacy check in for now since a lot of tilesets are still using the old header.
  // Legacy header #1: [batchLength] [batchTableByteLength]
  // Legacy header #2: [batchTableJsonByteLength] [batchTableBinaryByteLength] [batchLength]
  // Current header: [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength]
  // If the header is in the first legacy format 'batchTableJsonByteLength' will be the start of the JSON string (a quotation mark) or the glTF magic.
  // Accordingly its first byte will be either 0x22 or 0x67, and so the minimum uint32 expected is 0x22000000 = 570425344 = 570MB. It is unlikely that the feature table Json will exceed this length.
  // The check for the second legacy format is similar, except it checks 'batchTableBinaryByteLength' instead
  if (batchTableJsonByteLength >= 570425344) {
    // First legacy check
    headerByteLength = 20;
    batchLength = featureTableJsonByteLength;
    batchTableJsonByteLength = featureTableBinaryByteLength;
    batchTableBinaryByteLength = 0;
    featureTableJsonByteLength = 0;
    featureTableBinaryByteLength = 0;
  } else if (batchTableBinaryByteLength >= 570425344) {
    // Second legacy check
    headerByteLength = 24;
    batchLength = batchTableJsonByteLength;
    batchTableJsonByteLength = featureTableJsonByteLength;
    batchTableBinaryByteLength = featureTableBinaryByteLength;
    featureTableJsonByteLength = 0;
    featureTableBinaryByteLength = 0;
  }

  var featureTableJsonByteOffset = headerByteLength;
  var featureTableBinaryByteOffset =
    featureTableJsonByteOffset + featureTableJsonByteLength;
  var batchTableJsonByteOffset =
    featureTableBinaryByteOffset + featureTableBinaryByteLength;
  var batchTableBinaryByteOffset =
    batchTableJsonByteOffset + batchTableJsonByteLength;
  var glbByteOffset = batchTableBinaryByteOffset + batchTableBinaryByteLength;

  var featureTableJsonBuffer = b3dmBuffer.slice(
    featureTableJsonByteOffset,
    featureTableBinaryByteOffset
  );
  var featureTableBinary = b3dmBuffer.slice(
    featureTableBinaryByteOffset,
    batchTableJsonByteOffset
  );
  var batchTableJsonBuffer = b3dmBuffer.slice(
    batchTableJsonByteOffset,
    batchTableBinaryByteOffset
  );
  var batchTableBinary = b3dmBuffer.slice(
    batchTableBinaryByteOffset,
    glbByteOffset
  );
  var glbBuffer = b3dmBuffer.slice(glbByteOffset, byteLength);
  glbBuffer = alignGlb(glbBuffer, glbByteOffset);

  var featureTableJson = bufferToJson(featureTableJsonBuffer);
  var batchTableJson = bufferToJson(batchTableJsonBuffer);

  if (Object.keys(featureTableJson).length === 0) {
    featureTableJson = {
      BATCH_LENGTH: batchLength,
    };
  }

  return {
    header: {
      magic: magic,
      version: version,
    },
    featureTable: {
      json: featureTableJson,
      binary: featureTableBinary,
    },
    batchTable: {
      json: batchTableJson,
      binary: batchTableBinary,
    },
    glb: glbBuffer,
    glbLength: glbBuffer.byteLength,
  };
}
