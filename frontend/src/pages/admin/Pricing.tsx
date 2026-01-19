import { useEffect, useState } from 'react';
import { Table, InputNumber, Button, message } from 'antd';
import { admin } from '../../api';

export default function AdminPricing() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await admin.pricing();
      setData(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updatePrice = (resourceType: string, value: number) => {
    setData(data.map(d => d.resource_type === resourceType ? { ...d, unit_price: value } : d));
  };

  const save = async () => {
    setSaving(true);
    try {
      await admin.updatePricing(data.map(d => ({ resourceType: d.resource_type, unitPrice: d.unit_price })));
      message.success('保存成功');
    } catch (e: any) {
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resourceNames: Record<string, string> = {
    cpu: 'CPU (每核/天)',
    memory: '内存 (每GB/天)',
    storage: '存储 (每100GB/天)',
    gpu_3090: '显卡 3090 (每张/天)',
    gpu_t4: '显卡 T4 (每张/天)'
  };

  const columns = [
    { title: '资源类型', dataIndex: 'resource_type', render: (v: string) => resourceNames[v] || v },
    {
      title: '单价 (元)', dataIndex: 'unit_price', render: (v: number, record: any) => (
        <InputNumber
          value={v}
          min={0}
          step={0.001}
          precision={4}
          onChange={val => updatePrice(record.resource_type, val || 0)}
        />
      )
    }
  ];

  return (
    <div>
      <Table columns={columns} dataSource={data} rowKey="resource_type" loading={loading} pagination={false} />
      <div style={{ marginTop: 16 }}>
        <Button type="primary" onClick={save} loading={saving}>保存</Button>
      </div>
    </div>
  );
}
