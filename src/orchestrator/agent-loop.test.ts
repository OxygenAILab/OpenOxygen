/**
 * AgentLoop 单元测试:mock runInference,脚本化工具调用序列
 * 覆盖:回环执行/finish 终止/截图观察回填/最大步数/循环检测/纯文本收尾
 */
import { AgentLoop } from './agent-loop';
import { runInference } from '../inference/engine';
import type { InferenceResponse, ToolSchema } from '../inference/engine';

jest.mock('../inference/engine', () => ({
  runInference: jest.fn(),
}));

const mockedRun = runInference as jest.MockedFunction<typeof runInference>;

function resp(overrides: Partial<InferenceResponse>): InferenceResponse {
  return {
    id: 'r',
    content: '',
    model: 'mock',
    provider: 'mock',
    durationMs: 0,
    mode: 'balanced',
    ...overrides,
  };
}

function tool(name: string, args: any, id = `call_${Math.random()}`) {
  return { id, name, arguments: JSON.stringify(args) };
}

const guiStub = {
  screenshots: [] as string[],
  clicks: [] as any[],
  keys: [] as string[],
  screenSize: { width: 2048, height: 1152 },
  async screenshot() {
    // 构造带合法 IHDR 的假 PNG(截图工具会解析宽高计算缩放因子)
    const b = Buffer.alloc(26);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(1024, 16); // 截图宽
    b.writeUInt32BE(576, 20); // 截图高
    return b.toString('base64');
  },
  getScreenSize() {
    return this.screenSize;
  },
  async click(x: number, y: number) {
    this.clicks.push([x, y]);
    return { success: true };
  },
  async type_text(t: string) {
    return { success: true };
  },
  async key_press(k: string) {
    this.keys.push(k);
    return { success: true };
  },
  async scroll(n: number) {
    return { success: true };
  },
  async locateByDescription(d: string) {
    return d === 'nope' ? null : { x: 10, y: 20 };
  },
};

beforeEach(() => {
  mockedRun.mockReset();
  guiStub.clicks = [];
  guiStub.keys = [];
});

describe('AgentLoop', () => {
  it('回环执行:截图观察回填 → 点击 → finish', async () => {
    mockedRun
      .mockResolvedValueOnce(resp({ toolCalls: [tool('screenshot', {}, 'c1')] }))
      .mockImplementationOnce(async (req) => {
        // 第二轮:必须已经收到截图观察(user 消息带 images)
        const gotImage = req.messages.some((m) => m.role === 'user' && m.images?.length);
        expect(gotImage).toBe(true);
        return resp({ toolCalls: [tool('click', { x: 100, y: 200 }, 'c2')] });
      })
      .mockResolvedValueOnce(resp({ toolCalls: [tool('finish', { summary: '完成' }, 'c3')] }));

    const loop = new AgentLoop();
    const result = await loop.run({ goal: '点一下', model: { provider: 'openai', model: 'm' }, gui: guiStub });

    expect(result.success).toBe(true);
    expect(result.summary).toBe('完成');
    // 模型在截图坐标系点击 (100,200),截图 1024 宽/物理 2048 宽 → 物理坐标 (200,400)
    expect(guiStub.clicks).toEqual([[200, 400]]);
    // 不变量:click(c2) 的工具结果被回填进后续上下文(数组引用会被后续轮次继续 push,故用 some)
    const toolMsgs = mockedRun.mock.calls[1][0].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.some((m) => m.toolCallId === 'c2')).toBe(true);
  });

  it('达到最大步数时失败返回', async () => {
    mockedRun.mockResolvedValue(resp({ toolCalls: [tool('wait', { ms: 1 }, 'cw')] }));
    const loop = new AgentLoop();
    const result = await loop.run({
      goal: '永远等下去',
      model: { provider: 'openai', model: 'm' },
      gui: guiStub,
      maxSteps: 3,
    });
    expect(result.success).toBe(false);
    expect(result.steps).toBe(3);
    expect(result.error).toContain('最大步数');
  });

  it('同一动作连续 3 次判定循环卡死', async () => {
    mockedRun.mockResolvedValue(resp({ toolCalls: [tool('key', { combo: '#r' }, 'ck')] }));
    const loop = new AgentLoop();
    const result = await loop.run({
      goal: '卡死场景',
      model: { provider: 'openai', model: 'm' },
      gui: guiStub,
      maxSteps: 10,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('循环卡死');
    expect(guiStub.keys.length).toBe(2); // 第 3 次前就中止
  });

  it('连续两轮纯文本 → 视为 LLM 主动收尾', async () => {
    mockedRun
      .mockResolvedValueOnce(resp({ content: '这个任务没有可执行动作。' }))
      .mockResolvedValueOnce(resp({ content: '结束,总结如下。' }));
    const loop = new AgentLoop();
    const result = await loop.run({ goal: '纯文本目标', model: { provider: 'openai', model: 'm' }, gui: guiStub });
    expect(result.success).toBe(true);
    expect(result.summary).toBe('结束,总结如下。');
  });

  it('工具声明按可用能力裁剪:无 CLI 则不含 cli 工具', async () => {
    mockedRun.mockResolvedValue(resp({ toolCalls: [tool('finish', { summary: 'ok' }, 'cf')] }));
    const loop = new AgentLoop();
    await loop.run({ goal: 'x', model: { provider: 'openai', model: 'm' }, gui: guiStub });

    const tools = mockedRun.mock.calls[0][0].tools as ToolSchema[];
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('screenshot');
    expect(names).toContain('click');
    expect(names).toContain('finish');
    expect(names).not.toContain('cli');
  });

  it('坐标换算:截图坐标系点击自动乘缩放因子落到物理屏', async () => {
    // guiStub: 截图 1024 宽 / 物理屏 2048 宽 → scale = 0.5
    mockedRun
      .mockResolvedValueOnce(resp({ toolCalls: [tool('screenshot', {}, 'cs')] }))
      .mockResolvedValueOnce(resp({ toolCalls: [tool('click', { x: 100, y: 200 }, 'cc')] }))
      .mockResolvedValueOnce(resp({ toolCalls: [tool('finish', { summary: 'done' }, 'cf')] }));

    const loop = new AgentLoop();
    await loop.run({ goal: '截图后点一下', model: { provider: 'openai', model: 'm' }, gui: guiStub });

    // 截图系 (100,200) × (1/0.5) = 物理 (200,400)
    expect(guiStub.clicks).toEqual([[200, 400]]);
  });

  it('uia_locate 返回物理坐标但换算为截图坐标系告知模型', async () => {
    // locateByDescription 返回物理 (10,20),scale=0.5 → 截图坐标系应为 (5,10)(物理 × scale)
    mockedRun
      .mockResolvedValueOnce(resp({ toolCalls: [tool('screenshot', {}, 'cs')] }))
      .mockResolvedValueOnce(resp({ toolCalls: [tool('uia_locate', { description: '按钮' }, 'cu')] }))
      .mockImplementationOnce(async (req) => {
        const toolMsg = req.messages.filter((m) => m.role === 'tool').pop();
        expect(toolMsg?.content).toContain('(5, 10)');
        return resp({ toolCalls: [tool('finish', { summary: 'ok' }, 'cf')] });
      });

    const loop = new AgentLoop();
    await loop.run({ goal: '定位元素', model: { provider: 'openai', model: 'm' }, gui: guiStub });
  });

  it('cli 工具走执行器并回填输出', async () => {
    const cliStub = {
      execute: jest.fn().mockResolvedValue({ success: true, exit_code: 0, stdout: 'hello-stdout', stderr: '' }),
    };
    mockedRun
      .mockResolvedValueOnce(resp({ toolCalls: [tool('cli', { command: 'echo hello' }, 'cc')] }))
      .mockResolvedValueOnce(resp({ toolCalls: [tool('finish', { summary: 'done' }, 'cf')] }));

    const loop = new AgentLoop();
    const result = await loop.run({
      goal: '跑个命令',
      model: { provider: 'openai', model: 'm' },
      gui: guiStub,
      cli: cliStub,
    });

    expect(cliStub.execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'echo hello' }));
    const toolMsg = mockedRun.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('hello-stdout');
    expect(result.success).toBe(true);
  });
});
