import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntApp, ConfigProvider } from 'antd';
import { describe, expect, it } from 'vitest';
import { DemoApp } from '../examples/demo/src/App';
import { CapabilityLab } from '../examples/demo/src/CapabilityLab';

function renderWithAntApp(node: React.ReactNode) {
  return render(
    <ConfigProvider>
      <AntApp>{node}</AntApp>
    </ConfigProvider>,
  );
}

function statistic(title: string): HTMLElement {
  const root = screen.getByText(title).closest<HTMLElement>('.ant-statistic');
  if (!root) throw new Error(`Statistic not found: ${title}`);
  return root;
}

describe('interactive demo acceptance', () => {
  it('executes create, value-click detail, and delete through the complete workbench', async () => {
    renderWithAntApp(<DemoApp />);

    fireEvent.click(screen.getByText('快捷新建'));
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-title')).toHaveTextContent('新建订单'),
    );
    const editor = document.querySelector<HTMLElement>('.ant-modal');
    expect(editor).not.toBeNull();
    fireEvent.click(within(editor!).getByRole('button', { name: '创建订单' }));

    await waitFor(
      () => expect(within(statistic('当前订单')).getByText('138')).toBeInTheDocument(),
      { timeout: 3_000 },
    );

    const createdCell = await screen.findByLabelText('订单号: HY-20260138', undefined, {
      timeout: 4_000,
    });
    fireEvent.click(createdCell);

    const drawerTitle = await screen.findByText('订单详情 · HY-20260138');
    const drawer = drawerTitle.closest<HTMLElement>('.ant-drawer');
    expect(drawer).not.toBeNull();
    expect(within(drawer!).getByText('值点击 · 订单号')).toBeInTheDocument();
    fireEvent.click(within(drawer!).getByText('删除'));

    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm-title')).toHaveTextContent(
        '删除订单 HY-20260138？',
      ),
    );
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(
      () => expect(within(statistic('当前订单')).getByText('137')).toBeInTheDocument(),
      { timeout: 3_000 },
    );
  }, 20_000);

  it('keeps controlled result and entity-state provenance aligned across datasets', async () => {
    renderWithAntApp(<CapabilityLab />);

    const modeControl = screen.getByRole('radiogroup', { name: '数据源模式' });
    fireEvent.click(within(modeControl).getByText('受控').closest('label')!);
    expect(await screen.findByText('业务 Store')).toBeInTheDocument();
    expect(await screen.findByText('HY-20260001')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    await waitFor(() =>
      expect(within(statistic('外部 Store 选择')).getByText('1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('重置实验室'));
    expect(await screen.findByText('旧状态已屏蔽，等待新数据原子确认')).toBeInTheDocument();
    expect(await screen.findByText('capability-lab:controlled:1')).toBeInTheDocument();
    expect(within(statistic('外部 Store 选择')).getByText('0')).toBeInTheDocument();
  });
});
