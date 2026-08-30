import { WindowsGuiController } from './windows';

describe('WindowsGuiController.centerOfElement', () => {
  it('从 BoundingRectangle 计算中心点', () => {
    const el = { BoundingRectangle: { X: 100, Y: 200, Width: 40, Height: 20 } };
    expect(WindowsGuiController.centerOfElement(el)).toEqual({ x: 120, y: 210 });
  });

  it('无 BoundingRectangle 时返回 null（策略3 的 Get-Process 兜底只有 ProcessId）', () => {
    expect(WindowsGuiController.centerOfElement({ ProcessId: 1234 })).toBeNull();
    expect(WindowsGuiController.centerOfElement(null)).toBeNull();
  });

  it('宽高非正（屏外/隐藏元素）时返回 null', () => {
    const el = { BoundingRectangle: { X: 0, Y: 0, Width: 0, Height: 0 } };
    expect(WindowsGuiController.centerOfElement(el)).toBeNull();
  });

  it('坐标非有限值时返回 null', () => {
    const el = { BoundingRectangle: { X: Infinity, Y: 0, Width: 10, Height: 10 } };
    expect(WindowsGuiController.centerOfElement(el)).toBeNull();
  });

  it('坐标字段类型错误时返回 null', () => {
    const el = { BoundingRectangle: { X: '0', Y: 0, Width: 10, Height: 10 } };
    expect(WindowsGuiController.centerOfElement(el)).toBeNull();
  });
});
