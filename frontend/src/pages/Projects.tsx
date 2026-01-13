import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { projects } from '../api';

export default function Projects() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    const res = await projects.list();
    setData(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onCreate = async (values: any) => {
    await projects.create(values);
    message.success('创建成功');
    setModal(false);
    form.resetFields();
    load();
  };

  const onDelete = async (id: number) => {
    await projects.delete(id);
    message.success('删除成功');
    load();
  };

  const onSync = async (id: number) => {
    setSyncing(id);
    try {
      const res = await projects.sync(id);
      message.success(`同步成功，共 ${res.data.synced} 台虚拟机`);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '同步失败');
    }
    setSyncing(null);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '项目名称', dataIndex: 'name' },
    { title: 'vCenter Folder', dataIndex: 'vcenter_folder_path' },
    {
      title: '状态', dataIndex: 'status', render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag>
      )
    },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<SyncOutlined spin={syncing === record.id} />} onClick={() => onSync(record.id)}>
            同步VM
          </Button>
          <Popconfirm title="确认删除?" onConfirm={() => onDelete(record.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)}>
          添加项目
        </Button>
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title="添加项目" open={modal} onCancel={() => setModal(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input placeholder="例如：研发部门" />
          </Form.Item>
          <Form.Item name="vcenterFolderPath" label="vCenter Folder 路径" rules={[{ required: true }]}>
            <Input placeholder="例如：/Datacenter/vm/研发部门" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
