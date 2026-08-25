import { Alert, App, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Switch } from 'antd';
import { useEffect, useState } from 'react';
import {
  demoCustomers,
  demoOwners,
  demoTags,
  type DemoOrder,
  type OrderStatus,
  type RiskLevel,
} from './data';

export interface OrderFormValues {
  customerId: number;
  ownerId: number;
  amount: number;
  status: OrderStatus;
  risk: RiskLevel;
  tags: string[];
  paid: boolean;
}

export interface OrderEditorProps {
  open: boolean;
  order?: DemoOrder;
  onCancel: () => void;
  onSubmit: (values: OrderFormValues) => void | Promise<void>;
}

const statusOptions = [
  { label: '待处理', value: 'pending' },
  { label: '处理中', value: 'processing' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
];

const riskOptions = [
  { label: '低风险', value: 'low' },
  { label: '中风险', value: 'medium' },
  { label: '高风险', value: 'high' },
];

export function OrderEditor({ open, order, onCancel, onSubmit }: OrderEditorProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<OrderFormValues>();
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setSubmitError(undefined);
    form.setFieldsValue(
      order
        ? {
            customerId: order.customer.id,
            ownerId: order.owner.id,
            amount: order.amount,
            status: order.status,
            risk: order.risk,
            tags: order.tags,
            paid: order.paid,
          }
        : {
            customerId: demoCustomers[0]!.id,
            ownerId: demoOwners[0]!.id,
            amount: 1000,
            status: 'pending',
            risk: 'low',
            tags: ['重点'],
            paid: false,
          },
    );
  }, [form, open, order]);

  const submit = async () => {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    setSubmitError(undefined);
    try {
      await onSubmit(values);
    } catch (error) {
      const text = error instanceof Error ? error.message : '保存失败，请稍后重试。';
      setSubmitError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={order ? `编辑订单 ${order.orderNo}` : '新建订单'}
      okText={order ? '保存修改' : '创建订单'}
      cancelText="取消"
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      keyboard={!saving}
      mask={{ closable: !saving }}
      width={680}
      destroyOnHidden
      onCancel={() => {
        if (!saving) onCancel();
      }}
      onOk={() => void submit()}
    >
      <Form<OrderFormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        className="order-editor"
      >
        {submitError ? (
          <Alert className="order-editor__error" type="error" showIcon title={submitError} />
        ) : null}
        <Form.Item label="订单号">
          <Input value={order?.orderNo || '保存后自动生成'} disabled />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="customerId" label="客户" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={demoCustomers.map((item) => ({ label: item.name, value: item.id }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="ownerId" label="负责人" rules={[{ required: true }]}>
              <Select options={demoOwners.map((item) => ({ label: item.name, value: item.id }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="amount"
              label="订单金额"
              rules={[{ required: true }, { type: 'number', min: 0.01, max: 10_000_000 }]}
            >
              <InputNumber<number>
                min={0.01}
                max={10_000_000}
                precision={2}
                prefix="¥"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}>
              <Select options={statusOptions} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="risk" label="风险等级" rules={[{ required: true }]}>
          <Radio.Group options={riskOptions} optionType="button" buttonStyle="solid" />
        </Form.Item>
        <Form.Item name="tags" label="业务标签">
          <Select
            mode="multiple"
            allowClear
            options={demoTags.map((value) => ({ label: value, value }))}
          />
        </Form.Item>
        <Form.Item name="paid" label="是否支付" valuePropName="checked">
          <Switch checkedChildren="已支付" unCheckedChildren="未支付" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
