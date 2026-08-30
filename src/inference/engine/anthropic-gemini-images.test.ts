import {
  buildAnthropicMessages,
  buildGeminiContents,
  detectImageMime,
  type ChatMessage,
} from './index';

// PNG 魔数: 89 50 4E 47 → base64 "iVBORw0KGgo="
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// JPEG 魔数: FF D8 FF → base64 "/9j/"
const JPEG_B64 = '/9j/4AAQSkZJRg==';

describe('detectImageMime', () => {
  it('PNG 魔数识别为 image/png', () => {
    expect(detectImageMime(PNG_B64)).toBe('image/png');
  });

  it('JPEG 魔数识别为 image/jpeg', () => {
    expect(detectImageMime(JPEG_B64)).toBe('image/jpeg');
  });

  it('GIF 头识别为 image/gif', () => {
    // "GIF8" 的 base64
    expect(detectImageMime(Buffer.from('GIF89a').toString('base64'))).toBe('image/gif');
  });

  it('未知内容默认按 image/png 处理', () => {
    expect(detectImageMime(Buffer.from('hello world not an image').toString('base64'))).toBe(
      'image/png'
    );
    expect(detectImageMime('')).toBe('image/png');
  });
});

describe('buildAnthropicMessages', () => {
  it('有图时 content 变为内容块数组，source.data 为裸 base64', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '这是什么？', images: [`data:image/png;base64,${PNG_B64}`] },
    ];

    const result = buildAnthropicMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const blocks = result[0].content as Array<any>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: '这是什么？' });
    expect(blocks[1].type).toBe('image');
    expect(blocks[1].source.type).toBe('base64');
    expect(blocks[1].source.media_type).toBe('image/png');
    expect(blocks[1].source.data).toBe(PNG_B64); // 前缀已剥离
  });

  it('无图时 content 保持纯字符串', () => {
    const result = buildAnthropicMessages([{ role: 'user', content: 'hi' }]);
    expect(result[0].content).toBe('hi');
  });

  it('assistant 角色保留，其余映射为 user', () => {
    const result = buildAnthropicMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'tool', content: 'c' },
    ]);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('多张图片全部转换且顺序保持', () => {
    const result = buildAnthropicMessages([
      { role: 'user', content: '对比', images: [PNG_B64, JPEG_B64] },
    ]);
    const blocks = result[0].content as Array<any>;
    expect(blocks).toHaveLength(3);
    expect(blocks[1].source.media_type).toBe('image/png');
    expect(blocks[2].source.media_type).toBe('image/jpeg');
  });
});

describe('buildGeminiContents', () => {
  it('有图时用 inlineData part（驼峰），data 为裸 base64', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '这是什么？', images: [`data:image/png;base64,${PNG_B64}`] },
    ];

    const result = buildGeminiContents(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0]).toEqual({ text: '这是什么？' });
    const part = result[0].parts[1] as any;
    expect(part.inlineData.mimeType).toBe('image/png');
    expect(part.inlineData.data).toBe(PNG_B64);
  });

  it('无图时只有 text part', () => {
    const result = buildGeminiContents([{ role: 'user', content: 'hi' }]);
    expect(result[0].parts).toEqual([{ text: 'hi' }]);
  });

  it('角色映射：user 保持 user，其余映射为 model', () => {
    const result = buildGeminiContents([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'system', content: 'c' },
    ]);
    expect(result.map((c) => c.role)).toEqual(['user', 'model', 'model']);
  });
});
