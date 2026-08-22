import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Button, Descriptions, Drawer, Space, Tag, Timeline, Typography } from 'antd';
import type { DemoOrder } from './data';

export interface OrderDetailProps {
  order?: DemoOrder;
  source?: string;
  onClose: () => void;
  onEdit: (order: DemoOrder) => void;
  onDelete: (order: DemoOrder) => void;
}

const statusLabels = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已取消',
};

const riskLabels = { low: '低风险', medium: '中风险', high: '高风险' };

export function OrderDetail({ order, source, onClose, onEdit, onDelete }: OrderDetailProps) {
  return (
    <Drawer
      open={Boolean(order)}
      title={order ? `订单详情 · ${order.orderNo}` : '订单详情'}
      size={480}
      onClose={onClose}
      extra={
        order ? (
          <Space>
            <Button icon={<EditOutlined />} onClick={() => onEdit(order)}>
              编辑
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => onDelete(order)}>
              删除
            </Button>
          </Space>
        ) : null
      }
    >
      {order && (
        <>
          <div className="detail-source">
            <Typography.Text type="secondary">打开方式</Typography.Text>
            <Tag color="blue">{source || '未知入口'}</Tag>
          </div>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="订单号">{order.orderNo}</Descriptions.Item>
            <Descriptions.Item label="客户">{order.customer.name}</Descriptions.Item>
            <Descriptions.Item label="负责人">{order.owner.name}</Descriptions.Item>
            <Descriptions.Item label="金额">
              {new Intl.NumberFormat('zh-CN', {
                style: 'currency',
                currency: 'CNY',
              }).format(order.amount)}
            </Descriptions.Item>
            <Descriptions.Item label="状态">{statusLabels[order.status]}</Descriptions.Item>
            <Descriptions.Item label="风险">{riskLabels[order.risk]}</Descriptions.Item>
            <Descriptions.Item label="标签">
              <Space size={4} wrap>
                {order.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="支付">{order.paid ? '已支付' : '未支付'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Intl.DateTimeFormat('zh-CN', {
                dateStyle: 'long',
                timeStyle: 'short',
              }).format(new Date(order.createdAt))}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} className="detail-timeline-title">
            订单动态
          </Typography.Title>
          <Timeline
            items={[
              {
                icon: <CheckCircleOutlined />,
                color: 'green',
                content: `订单由 ${order.owner.name} 创建`,
              },
              {
                icon: <ClockCircleOutlined />,
                content: '等待下一次业务状态同步',
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
