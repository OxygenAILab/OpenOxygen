import { isSendKeysCombo } from './robot';

describe('isSendKeysCombo', () => {
  it('识别单键 {ENTER} / {ESC} 等', () => {
    expect(isSendKeysCombo('{ENTER}')).toBe(true);
    expect(isSendKeysCombo('{ESC}')).toBe(true);
    expect(isSendKeysCombo('{DELETE}')).toBe(true);
    expect(isSendKeysCombo('{TAB}')).toBe(true);
  });

  it('识别修饰符组合键 #r / ^a / %{F4} / +{TAB} / ^{ESC}', () => {
    expect(isSendKeysCombo('#r')).toBe(true);
    expect(isSendKeysCombo('^a')).toBe(true);
    expect(isSendKeysCombo('%{F4}')).toBe(true);
    expect(isSendKeysCombo('+{TAB}')).toBe(true);
    expect(isSendKeysCombo('^{ESC}')).toBe(true);
    expect(isSendKeysCombo('#e')).toBe(true);
  });

  it('普通文本按字面输入处理', () => {
    expect(isSendKeysCombo('notepad')).toBe(false);
    expect(isSendKeysCombo('Hello World')).toBe(false);
    expect(isSendKeysCombo('1234+5678')).toBe(false);
  });

  it('混合内容（文本+按键）不路由，按字面输入', () => {
    expect(isSendKeysCombo('Hello{ENTER}')).toBe(false);
    expect(isSendKeysCombo('^c复制')).toBe(false);
  });

  it('空串与非字符串安全返回 false', () => {
    expect(isSendKeysCombo('')).toBe(false);
    expect(isSendKeysCombo(null as any)).toBe(false);
    expect(isSendKeysCombo(undefined as any)).toBe(false);
  });
});
