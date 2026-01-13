import { useEffect, useState } from 'react';
import { Table, Button, Tag, Card, Row, Col, Statistic, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { billing } from '../api';

export default function Billing() {
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    billing.bills()
      .then(res => setBills(res.data))
      .catch((e: any) => message.error(e.response?.data?.error || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const totalCost = bills.reduce((sum, b) => sum + parseFloat(b.total_cost), 0);

  const columns = [
    { title: '账期', dataIndex: 'billing_period' },
    { title: 'CPU费用', dataIndex: 'cpu_cost', render: (v: string) => `¥${v}` },
    { title: '内存费用', dataIndex: 'memory_cost', render: (v: string) => `¥${v}` },
    { title: '存储费用', dataIndex: 'storage_cost', render: (v: string) => `¥${v}` },
    { title: 'GPU费用', dataIndex: 'gpu_cost', render: (v: string) => `¥${v}` },
    { title: '总费用', dataIndex: 'total_cost', render: (v: string) => <strong>¥{v}</strong> },
    {
      title: '状态', dataIndex: 'status', render: (v: string) => (
        <Tag color={v === 'paid' ? 'green' : 'orange'}>{v === 'paid' ? '已支付' : '待支付'}</Tag>
      )
    },
    {
      title: '操作', render: (_: any, record: any) => (
        <Button size="small" icon={<DownloadOutlined />} href={billing.exportBill(record.id)} target="_blank">
          导出
        </Button>
      )
    }
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card><Statistic title="账单总数" value={bills.length} /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="总费用" value={totalCost} prefix="¥" precision={2} /></Card>
        </Col>
      </Row>
      <Table columns={columns} dataSource={bills} rowKey="id" loading={loading} />
    </div>
  );
}
