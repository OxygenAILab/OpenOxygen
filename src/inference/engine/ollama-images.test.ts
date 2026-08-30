import { buildOllamaMessages, stripDataUriPrefix, type ChatMessage } from './index';

describe('stripDataUriPrefix', () => {
  it('剥离 data URI 前缀，返回裸 base64', () => {
    expect(stripDataUriPrefix('data:image/png;base64,AAAB')).toBe('AAAB');
    expect(stripDataUriPrefix('data:image/jpeg;base64,ZZZ=')).toBe('ZZZ=');
  });

  it('对裸 base64 原样返回', () => {
    expect(stripDataUriPrefix('AAAB')).toBe('AAAB');
  });
});

describe('buildOllamaMessages', () => {
  it('图片进入 messages[].images 且被剥离前缀，不塞进 content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '这是什么？', images: ['data:image/png;base64,IMGDATA'] },
    ];

    const result = buildOllamaMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('这是什么？');
    expect(result[0].images).toEqual(['IMGDATA']);
  });

  it('无图片时不设置 images 字段', () => {
    const result = buildOllamaMessages([{ role: 'user', content: 'hi' }]);
    expect(result[0].images).toBeUndefined();
  });

  it('systemPrompt 会被前插为 system 消息', () => {
    const result = buildOllamaMessages([{ role: 'user', content: 'hi' }], '你是助手');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: '你是助手' });
    expect(result[1].content).toBe('hi');
  });
});
