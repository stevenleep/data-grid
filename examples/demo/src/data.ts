export type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface DemoOrder {
  id: number;
  orderNo: string;
  customer: { id: number; name: string };
  owner: { id: number; name: string; avatar?: string };
  amount: number;
  status: OrderStatus;
  risk: RiskLevel;
  tags: string[];
  paid: boolean;
  createdAt: string;
}

export const demoCustomers = [
  { id: 1, name: '星云科技' },
  { id: 2, name: '远山贸易' },
  { id: 3, name: '云帆智能' },
  { id: 4, name: '北辰零售' },
  { id: 5, name: '青川制造' },
  { id: 6, name: '知行教育' },
  { id: 7, name: '澄海物流' },
  { id: 8, name: '原点设计' },
];

export const demoOwners = [
  { id: 1, name: '林溪' },
  { id: 2, name: '陈默' },
  { id: 3, name: '周舟' },
  { id: 4, name: '何川' },
  { id: 5, name: '苏禾' },
];

export const demoStatuses: OrderStatus[] = ['pending', 'processing', 'completed', 'cancelled'];
export const demoRisks: RiskLevel[] = ['low', 'medium', 'high'];
export const demoTags = ['重点', '复购', '企业', '渠道', '订阅', '续费'];

export function createDemoOrders(count = 137): DemoOrder[] {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const createdAt = new Date(Date.UTC(2026, 7, 22 - (index % 90), 1 + (index % 16), 15));
    return {
      id,
      orderNo: `HY-${String(20260000 + id)}`,
      customer: demoCustomers[index % demoCustomers.length]!,
      owner: demoOwners[index % demoOwners.length]!,
      amount: Number((1280 + ((index * 7919) % 89000) / 10).toFixed(2)),
      status: demoStatuses[index % demoStatuses.length]!,
      risk: demoRisks[(index * 2) % demoRisks.length]!,
      tags: [demoTags[index % demoTags.length]!, demoTags[(index + 2) % demoTags.length]!],
      paid: index % 3 !== 0,
      createdAt: createdAt.toISOString(),
    };
  });
}

export function waitForServer(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
