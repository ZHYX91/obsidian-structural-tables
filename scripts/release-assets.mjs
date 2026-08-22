import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ASSETS = ["main.js", "manifest.json", "styles.css"];
const ZIP_DATE = 0x0021;
const ZIP_MODE = 0o100644;
const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(content) {
  let value = 0xFFFFFFFF;
  for (const byte of content) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

function deterministicZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034B50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(ZIP_DATE, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, content);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014B50, 0);
    directory.writeUInt16LE((3 << 8) | 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(ZIP_DATE, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(content.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((ZIP_MODE << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + content.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

async function regularFile(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
    throw new Error(`Release asset is not a non-empty regular file: ${filePath}`);
  }
  return readFile(filePath);
}

const [command, ...arguments_] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  if (!key?.startsWith("--") || !value || options.has(key)) {
    throw new Error("Usage: node scripts/release-assets.mjs handoff --version <x.y.z> --output-dir <directory>");
  }
  options.set(key, value);
}
const version = options.get("--version");
const outputArgument = options.get("--output-dir");
if (
  command !== "handoff" ||
  options.size !== 2 ||
  !outputArgument ||
  !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version ?? "")
) {
  throw new Error("Usage: node scripts/release-assets.mjs handoff --version <x.y.z> --output-dir <directory>");
}
const output = path.resolve(outputArgument ?? "release");
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.id !== "structural-tables" || manifest.version !== version) {
  throw new Error("dist/manifest.json does not match the requested Structural Tables release");
}
await mkdir(output, { recursive: true });
const entries = [];
for (const name of ASSETS) {
  const content = await regularFile(path.join("dist", name));
  await cp(path.join("dist", name), path.join(output, name), { errorOnExist: true, force: false });
  entries.push({ name: `structural-tables/${name}`, content });
}
const archiveName = `structural-tables-${version}.zip`;
const archive = deterministicZip(entries);
await writeFile(path.join(output, archiveName), archive, { flag: "wx", mode: 0o644 });
const checksumLines = await Promise.all([...ASSETS, archiveName].map(async (name) => {
  const digest = createHash("sha256").update(await readFile(path.join(output, name))).digest("hex");
  return `${digest}  ${name}`;
}));
await writeFile(path.join(output, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, { flag: "wx" });
process.stdout.write(`Created deterministic release handoff in ${output}.\n`);
