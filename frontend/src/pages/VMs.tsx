import { useEffect, useState } from 'react';
import { Table, Button, Tag, message, Space, Select } from 'antd';
import { PoweroffOutlined, PlayCircleOutlined, DesktopOutlined } from '@ant-design/icons';
import { vms, projects } from '../api';

export default function VMs() {
  const [data, setData] = useState([]);
  const [projectList, setProjectList] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [vmRes, projRes] = await Promise.all([vms.list(selectedProject), projects.list()]);
      setData(vmRes.data);
      setProjectList(projRes.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedProject]);

  const powerOn = async (id: number) => {
    try {
      await vms.powerOn(id);
      message.success('开机指令已发送');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const powerOff = async (id: number) => {
    try {
      await vms.powerOff(id);
      message.success('关机指令已发送');
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

  const columns = [
    { 
      title: '名称', 
      dataIndex: 'name',
      render: (v: string) => (
        <Space>
          <DesktopOutlined style={{ color: '#00d4ff' }} />
          <span style={{ fontWeight: 500 }}>{v}</span>
        </Space>
      )
    },
    {
      title: '项目',
      dataIndex: 'project_name',
      render: (_: any, record: any) =>
        record.project_code ? (
          <code style={{ 
            background: 'rgba(0, 212, 255, 0.1)', 
            padding: '2px 8px', 
            borderRadius: 4, 
            color: '#00d4ff',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11
          }}>
            {record.project_name} ({record.project_code})
          </code>
        ) : record.project_name
    },
    { 
      title: 'CPU', 
      dataIndex: 'cpu_cores', 
      render: (v: number) => (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{v} 核</span>
      )
    },
    { 
      title: '内存', 
      dataIndex: 'memory_gb', 
      render: (v: number) => (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{v} GB</span>
      )
    },
    { 
      title: '存储', 
      dataIndex: 'storage_gb', 
      render: (v: number) => (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{v} GB</span>
      )
    },
    { 
      title: 'GPU数量', 
      dataIndex: 'gpu_count',
      render: (v: number) => v > 0 ? (
        <Tag style={{ 
          background: 'rgba(139, 92, 246, 0.15)', 
          border: 'none', 
          color: '#8b5cf6' 
        }}>
          {v}
        </Tag>
      ) : '-'
    },
    { title: 'GPU型号', dataIndex: 'gpu_type', render: (v: string) => v || '-' },
    { 
      title: '创建时间', 
      dataIndex: 'create_time', 
      render: (v: string) => (
        <span style={{ color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {formatDateTime(v)}
        </span>
      )
    },
    { 
      title: '结束时间', 
      dataIndex: 'end_time', 
      render: (v: string) => (
        <span style={{ color: '#94a3b8', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
          {formatDateTime(v)}
        </span>
      )
    },
    { title: '所有者', dataIndex: 'owner', render: (v: string) => v || '-' },
    {
      title: '状态', 
      dataIndex: 'status', 
      render: (v: string) => {
        const colors: Record<string, { bg: string, color: string }> = {
          'POWERED_ON': { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' },
          'POWERED_OFF': { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }
        };
        const style = colors[v] || { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8' };
        return (
          <Tag style={{ 
            background: style.bg, 
            border: 'none', 
            color: style.color 
          }}>
            {v}
          </Tag>
        );
      }
    },
    {
      title: '操作', 
      render: (_: any, record: any) => (
        <Space size="small">
          <Button 
            size="small" 
            icon={<PlayCircleOutlined />} 
            onClick={() => powerOn(record.id)} 
            disabled={record.status === 'POWERED_ON'}
            style={{ 
              background: record.status !== 'POWERED_ON' ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
              borderColor: record.status !== 'POWERED_ON' ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)',
              color: record.status !== 'POWERED_ON' ? '#10b981' : 'var(--text-muted)'
            }}
          >
            开机
          </Button>
          <Button 
            size="small" 
            icon={<PoweroffOutlined />} 
            onClick={() => powerOff(record.id)} 
            disabled={record.status === 'POWERED_OFF'}
            style={{ 
              background: record.status !== 'POWERED_OFF' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              borderColor: record.status !== 'POWERED_OFF' ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)',
              color: record.status !== 'POWERED_OFF' ? '#ef4444' : 'var(--text-muted)'
            }}
          >
            关机
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div className="page-title">
        <DesktopOutlined style={{ color: '#00d4ff' }} />
        虚拟机管理
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <Select
          style={{ width: 280 }}
          placeholder="筛选项目"
          allowClear
          value={selectedProject}
          onChange={setSelectedProject}
          options={projectList.map(p => ({
            label: p.project_code ? `${p.name} (${p.project_code})` : p.name,
            value: p.id
          }))}
        />
      </div>
      
      <Table 
        columns={columns} 
        dataSource={data} 
        rowKey="id" 
        loading={loading}
        scroll={{ x: 1200 }}
      />
    </div>
  );
}