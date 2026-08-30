import { buildOpenAIMessages, ensureDataUriPrefix, type ChatMessage } from './index';

describe('ensureDataUriPrefix', () => {
  it('裸 base64 补 PNG data URI 前缀', () => {
    expect(ensureDataUriPrefix('AAAB')).toBe('data:image/png;base64,AAAB');
  });

  it('已有 data URI 前缀原样返回', () => {
    expect(ensureDataUriPrefix('data:image/jpeg;base64,ZZZ=')).toBe(
      'data:image/jpeg;base64,ZZZ='
    );
  });
});

describe('buildOpenAIMessages', () => {
  it('有图时 content 变为多模态数组（text + image_url），图片带 data URI 前缀', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '这是什么？', images: ['IMGDATA'] },
    ];

    const result = buildOpenAIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const parts = result[0].content as Array<any>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: '这是什么？' });
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url).toBe('data:image/png;base64,IMGDATA');
  });

  it('无图时 content 保持纯字符串，不产生多余部分', () => {
    const result = buildOpenAIMessages([{ role: 'user', content: 'hi' }]);
    expect(result[0].content).toBe('hi');
  });

  it('systemPrompt 前插为 system 消息', () => {
    const result = buildOpenAIMessages([{ role: 'user', content: 'hi' }], '你是助手');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: '你是助手' });
    expect(result[1].content).toBe('hi');
  });

  it('多张图片全部转换且顺序保持', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '对比', images: ['AAA', 'BBB'] },
    ];
    const parts = buildOpenAIMessages(messages)[0].content as Array<any>;
    expect(parts).toHaveLength(3);
    expect(parts[1].image_url.url).toContain('AAA');
    expect(parts[2].image_url.url).toContain('BBB');
  });
});
