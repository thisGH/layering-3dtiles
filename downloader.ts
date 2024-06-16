const fs = require("fs");
const axios = require("axios");
const path = require("path");
const fsExtra = require("fs-extra");

const tilesetUrl = 'https://assets.ion.cesium.com/ap-northeast-1/40866/tileset.json?v=2';

// 输出目录
const outputDir = path.join(__dirname, 'download', `${new Date().getTime()}`);

// 创建输出目录
if (!fs.existsSync(outputDir)) {
  fsExtra.mkdirsSync(outputDir);
} else {
  fsExtra.emptyDirSync(outputDir)
}

fsExtra.outputFileSync(path.join(outputDir, 'url.txt'), tilesetUrl)

// 下载 3D Tiles 文件
async function downloadTileset() {
  try {
    const response = await axios.get(tilesetUrl, { responseType: "json", Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhNTExNzEzMC1mNGZmLTQ1OTktYWM0Mi1hNDFmNzMyNzU3MWQiLCJpZCI6MjU5LCJhc3NldElkIjo0MDg2NiwiYXNzZXRzIjp7IjQwODY2Ijp7InR5cGUiOiIzRFRJTEVTIn19LCJzcmMiOiI3ODZkMDQzOS03ZGJjLTQzZWUtYjlmYy04ZmM5Y2UwNzNhMmYiLCJpYXQiOjE3MTg1MzY2NjYsImV4cCI6MTcxODU0MDI2Nn0.248a-QxYxmRXB517vonGZDvHeL0PUJdxx-s9B6R9lmE"  });
    console.log(response)
    const tileset = response.data;

    // 遍历 tileset
    traverseTileset(tileset.root, outputDir);
    console.log("下载完成！");
  } catch (error) {
    console.error("下载失败:", error.message);
  }
}

// 遍历 tileset 并下载 b3dm 文件
function traverseTileset(node, parentDir) {
  if (node.content) {
    // 下载 b3dm 文件
    downloadB3DM(node.content, parentDir);
  }

  if (node.children) {
    // 递归遍历子节点
    node.children.forEach((child) => {
      traverseTileset(child, parentDir);
    });
  }
}

// 下载 b3dm 文件
async function downloadB3DM(url, parentDir) {
  const filename = path.basename(url);
  const filePath = path.join(parentDir, filename);

  try {
    const response = await axios.get(url, { responseType: "arraybuffer", Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwNTkzNjkzNS0yYWMzLTRmZTYtYTU1Yy1hZTllMWVlZGFjYjIiLCJpZCI6MjU5LCJhc3NldElkIjo0MDg2NiwiYXNzZXRzIjp7IjQwODY2Ijp7InR5cGUiOiIzRFRJTEVTIn19LCJzcmMiOiI3ODZkMDQzOS03ZGJjLTQzZWUtYjlmYy04ZmM5Y2UwNzNhMmYiLCJpYXQiOjE3MTg1MzQyMDMsImV4cCI6MTcxODUzNzgwM30.YHQ8QJ8EmiruT6cR6Vwx4D6XwUGcQiSqkWDFA-jDLbA" });
    fs.writeFileSync(filePath, response.data);
    console.log("已下载:", filePath);
  } catch (error) {
    console.error("下载失败:", url, error.message);
  }
}

// 执行下载
downloadTileset();

export {}
