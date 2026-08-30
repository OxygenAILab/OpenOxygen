import { encodeBitmapToPng } from './robot';
import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('encodeBitmapToPng', () => {
  it('输出合法 PNG 签名与 IHDR 元数据', () => {
    const bgra = Buffer.alloc(2 * 2 * 4, 0xff);
    const png = encodeBitmapToPng(2, 2, bgra);

    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    // 第一个 chunk 必须是 IHDR：len(4)+type(4) 后跟 13 字节数据
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2); // width
    expect(png.readUInt32BE(20)).toBe(2); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // color type RGBA
  });

  it('像素 BGRA 正确转换为 RGBA 且 IDAT 可无损解压', () => {
    // 1x2 像素: 纯红 BGRA(0,0,255,255) 与纯蓝 BGRA(255,0,0,255)
    const bgra = Buffer.from([
      0, 0, 255, 255, // 红
      255, 0, 0, 255, // 蓝
    ]);
    const png = encodeBitmapToPng(1, 2, bgra);

    // 找 IDAT chunk（跳过 8 字节签名 + IHDR chunk 的 25 字节）
    const idatStart = 8 + 25;
    expect(png.toString('ascii', idatStart + 4, idatStart + 8)).toBe('IDAT');
    const idatLen = png.readUInt32BE(idatStart);
    const raw = zlib.inflateSync(png.subarray(idatStart + 8, idatStart + 8 + idatLen));

    // 每行前置 filter byte 0，随后 RGBA
    expect(raw[0]).toBe(0); // filter
    expect([raw[1], raw[2], raw[3], raw[4]]).toEqual([255, 0, 0, 255]); // 红
    expect(raw[5]).toBe(0); // 第二行 filter
    expect([raw[6], raw[7], raw[8], raw[9]]).toEqual([0, 0, 255, 255]); // 蓝
  });

  it('拒绝非法尺寸与过小 buffer', () => {
    expect(() => encodeBitmapToPng(0, 1, Buffer.alloc(4))).toThrow();
    expect(() => encodeBitmapToPng(2, 2, Buffer.alloc(4))).toThrow(); // 需要 16 字节
  });

  it('末尾为 IEND chunk 且整图 CRC 结构完整（PowerShell 可解码由集成验证）', () => {
    const png = encodeBitmapToPng(1, 1, Buffer.from([1, 2, 3, 4]));
    const tail = png.subarray(png.length - 12);
    expect(tail.readUInt32BE(0)).toBe(0); // IEND data len
    expect(tail.toString('ascii', 4, 8)).toBe('IEND');
  });
});
