import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, message, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined, SyncOutlined, FolderOutlined, DeleteOutlined } from '@ant-design/icons';
import { projects } from '../api';

export default function Projects() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await projects.list();
      setData(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onCreate = async (values: any) => {
    try {
      await projects.create(values);
      message.success('创建成功');
      setModal(false);
      form.resetFields();
      load();
      Modal.info({
        title: '提示',
        content: '项目创建成功！系统将在10分钟内自动同步虚拟机，您也可以稍后手动点击"同步VM"按钮进行同步。',
      });
    } catch (e: any) {
      message.error(e.response?.data?.error || '创建失败');
    }
  };

  const onDelete = async (id: number) => {
    try {
      await projects.delete(id);
      message.success('删除成功');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
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
    { 
      title: '项目名称', 
      dataIndex: 'name',
      render: (v: string) => (
        <Space>
          <FolderOutlined style={{ color: '#00d4ff' }} />
          <span style={{ fontWeight: 500 }}>{v}</span>
        </Space>
      )
    },
    { title: '项目编号', dataIndex: 'project_code', render: (v: string) => (
      <code style={{ 
        background: 'rgba(0, 212, 255, 0.1)', 
        padding: '2px 8px', 
        borderRadius: 4, 
        color: '#00d4ff',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12
      }}>{v}</code>
    )},
    {
      title: '状态', 
      dataIndex: 'status', 
      render: (v: string) => (
        <Tag color={v === 'active' ? 'success' : 'default'} style={{ 
          background: v === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
          border: 'none',
          color: v === 'active' ? '#10b981' : '#94a3b8'
        }}>
          {v === 'active' ? 'ACTIVE' : v.toUpperCase()}
        </Tag>
      )
    },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => (
      <span style={{ color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
        {new Date(v).toLocaleString()}
      </span>
    )},
    {
      title: '操作', 
      render: (_: any, record: any) => (
        <Space size="small">
          <Button 
            size="small" 
            icon={<SyncOutlined spin={syncing === record.id} />} 
            onClick={() => onSync(record.id)}
            style={{ 
              background: 'rgba(0, 212, 255, 0.1)',
              borderColor: 'rgba(0, 212, 255, 0.3)',
              color: '#00d4ff'
            }}
          >
            同步VM
          </Button>
          <Popconfirm 
            title="确认删除?" 
            onConfirm={() => onDelete(record.id)}
            okButtonProps={{ danger: true }}
          >
            <Button 
              size="small" 
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div className="page-title">
        <FolderOutlined style={{ color: '#00d4ff' }} />
        项目管理
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <Button 
          type="primary" 
          icon={<PlusOutlined />} 
          onClick={() => setModal(true)}
          style={{ 
            background: 'linear-gradient(135deg, #00d4ff, #3b82f6)',
            border: 'none'
          }}
        >
          添加项目
        </Button>
      </div>
      
      <Table 
        columns={columns} 
        dataSource={data} 
        rowKey="id" 
        loading={loading}
        style={{ 
          background: 'var(--bg-card)',
          borderRadius: 12,
          overflow: 'hidden'
        }}
      />
      
      <Modal 
        title={
          <Space>
            <PlusOutlined style={{ color: '#00d4ff' }} />
            添加项目
          </Space>
        } 
        open={modal} 
        onCancel={() => setModal(false)} 
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form 
          form={form} 
          layout="vertical" 
          onFinish={onCreate}
          style={{ marginTop: 24 }}
        >
          <Form.Item 
            name="name" 
            label="项目名称" 
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input 
              placeholder="例如：研发部门" 
              prefix={<FolderOutlined style={{ color: '#64748b' }} />}
            />
          </Form.Item>
          <Form.Item
            name="projectCode"
            label="项目编号"
            rules={[
              { required: true, message: '请输入项目编号' },
              { pattern: /^[A-Z0-9_-]+$/, message: '仅允许大写字母、数字、-、_' }
            ]}
          >
            <Input 
              placeholder="例如：PROJ-000001" 
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}