/**
 * 验证 Vision 链路(截图 → mock-brain → 我作 VLM 作答)
 *
 * 前置: mock-brain-server 已在 localhost:11434(vision 模块硬编码该地址)
 * 用法: npx tsx scripts/test-vision-mock.ts [图片路径] [目标描述]
 */

import { findElement } from '../src/execution/vision';

async function main(): Promise<void> {
  const imagePath = process.argv[2] || `${process.env.TEMP}\\openoxygen-mock\\test-screen.png`;
  const target = process.argv[3] || '记事本';

  console.log(`[test] 图片: ${imagePath}`);
  console.log(`[test] 查找目标: ${target}`);
  console.log('[test] 调用 findElement (等待 mock-brain VLM 作答)...');

  const element = await findElement(imagePath, target);

  if (!element) {
    console.error('[test] ❌ 未找到元素');
    process.exit(1);
  }

  console.log('\n[test] ✅ 找到元素:');
  console.log(`  id: ${element.id}`);
  console.log(`  type: ${element.type}`);
  console.log(`  text: ${element.text}`);
  console.log(`  bounds: x=${element.bounds.x} y=${element.bounds.y} w=${element.bounds.width} h=${element.bounds.height}`);
  console.log(`  confidence: ${element.confidence}`);

  if (element.bounds.width <= 0 || element.bounds.height <= 0) {
    throw new Error('bounds 非法(宽高非正)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[test] ❌ 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
