import { useEffect, useState } from 'react';
import { Table, Button, message, Select, Tag, Modal, Space } from 'antd';
import { gpu } from '../../api';

type GPURecord = {
  id: number;
  device_id: string;
  device_name: string;
  gpu_model: string;
  host_name: string;
  host_id: string;
  status: string;
  allocated_to_vm?: string | null;
  last_synced_at?: string | null;
};

const statusColors: Record<string, string> = {
  available: 'green',
  reserved: 'orange',
  in_use: 'blue',
  maintenance: 'red'
};

const statusOptions = [
  { label: 'All', value: '' },
  { label: 'available', value: 'available' },
  { label: 'reserved', value: 'reserved' },
  { label: 'in_use', value: 'in_use' },
  { label: 'maintenance', value: 'maintenance' }
];

export default function GPUInventory() {
  const [data, setData] = useState<GPURecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const load = async (status = statusFilter) => {
    setLoading(true);
    try {
      const res = await gpu.inventory(status ? { status } : undefined);
      const payload = res.data || {};
      setData(payload.data || payload || []);
      setLastSyncedAt(payload.last_synced_at || null);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load GPU inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await gpu.sync();
      message.success('GPU inventory synced');
      await load();
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '-');

  const toggleMaintenance = (record: GPURecord) => {
    const nextStatus = record.status === 'maintenance' ? 'available' : 'maintenance';
    Modal.confirm({
      title: `Set status to ${nextStatus}?`,
      content: `GPU ${record.device_id} (${record.gpu_model}) on ${record.host_name}`,
      okText: 'Confirm',
      cancelText: 'Cancel',
      onOk: async () => {
        await gpu.updateStatus(record.id, nextStatus);
        message.success('Status updated');
        await load();
      }
    });
  };

  const columns = [
    { title: 'Host', dataIndex: 'host_name' },
    { title: 'Model', dataIndex: 'gpu_model' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => <Tag color={statusColors[value] || 'default'}>{value}</Tag>
    },
    {
      title: 'Assigned VM',
      dataIndex: 'allocated_to_vm',
      render: (value: string) => value || '-'
    },
    { title: 'Device ID', dataIndex: 'device_id' },
    {
      title: 'Last Synced',
      dataIndex: 'last_synced_at',
      render: (value: string) => formatDateTime(value)
    },
    {
      title: 'Actions',
      render: (_: any, record: GPURecord) => (
        <Button
          size="small"
          onClick={() => toggleMaintenance(record)}
          disabled={record.status === 'reserved' || record.status === 'in_use'}
        >
          {record.status === 'maintenance' ? 'Mark Available' : 'Mark Maintenance'}
        </Button>
      )
    }
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 180 }}
          value={statusFilter}
          options={statusOptions}
          onChange={(value) => setStatusFilter(value)}
        />
        <Button type="primary" onClick={handleSync} loading={syncing}>Sync Inventory</Button>
        <span>Last sync: {formatDateTime(lastSyncedAt)}</span>
      </Space>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
    </div>
  );
}
