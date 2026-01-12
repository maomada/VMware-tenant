import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { tenants } from '../api';

export default function Tenants() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [form] = Form.useForm();
  const [editId, setEditId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await tenants.list();
    setData(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onSubmit = async (values: any) => {
    if (editId) {
      await tenants.update(editId, values);
      message.success('更新成功');
    } else {
      await tenants.create(values);
      message.success('创建成功');
    }
    setModal(false);
    form.resetFields();
    setEditId(null);
    load();
  };

  const onEdit = (record: any) => {
    setEditId(record.id);
    form.setFieldsValue({ name: record.name, contactEmail: record.contact_email, status: record.status });
    setModal(true);
  };

  const onDelete = async (id: number) => {
    await tenants.delete(id);
    message.success('删除成功');
    load();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name' },
    { title: '联系邮箱', dataIndex: 'contact_email' },
    { title: '状态', dataIndex: 'status' },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', render: (_: any, record: any) => (
        <Space>
          <Button size="small" onClick={() => onEdit(record)}>编辑</Button>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditId(null); form.resetFields(); setModal(true); }}>
          新建租户
        </Button>
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title={editId ? '编辑租户' : '新建租户'} open={modal} onCancel={() => setModal(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactEmail" label="联系邮箱">
            <Input />
          </Form.Item>
          {editId && (
            <Form.Item name="status" label="状态">
              <Input />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
