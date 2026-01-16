import { useEffect, useState } from 'react';
import { Table, Button, Card, Row, Col, Statistic, message, DatePicker, Select, Space } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { dailyBilling, projects } from '../api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function DailyBilling() {
  const [bills, setBills] = useState<any[]>([]);
  const [projectList, setProjectList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | undefined>();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setIsAdmin(user.role === 'admin');
    loadProjects();
    loadBills();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await projects.list();
      setProjectList(res.data);
    } catch (e) {
      console.error('Load projects error:', e);
    }
  };

  const loadBills = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateRange) {
        params.startDate = dateRange[0].format('YYYY-MM-DD');
        params.endDate = dateRange[1].format('YYYY-MM-DD');
      }
      if (selectedProject) {
        params.projectId = selectedProject;
      }
      const res = await dailyBilling.list(params);
      setBills(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (type: 'day' | 'month' | 'quarter') => {
    const params: any = {};
    if (dateRange) {
      params.startDate = dateRange[0].format('YYYY-MM-DD');
      params.endDate = dateRange[1].format('YYYY-MM-DD');
    }
    if (selectedProject) {
      params.projectId = selectedProject;
    }
    const token = localStorage.getItem('token');
    window.open(dailyBilling.exportUrl(type, params) + `&token=${token}`, '_blank');
  };

  const handleGenerate = async () => {
    try {
      const res = await dailyBilling.generate();
      message.success(res.data.message);
      loadBills();
    } catch (e: any) {
      message.error(e.response?.data?.error || '生成失败');
    }
  };

  const totalCost = bills.reduce((sum, b) => sum + parseFloat(b.daily_cost || 0), 0);
  const totalDays = bills.length;

  const columns = [
    { title: '项目名称', dataIndex: 'project_name', width: 150 },
    { title: '虚机名称', dataIndex: 'vm_name', width: 180 },
    { title: '虚机ID', dataIndex: 'vcenter_vm_id', width: 120 },
    {
      title: '计费日期', dataIndex: 'bill_date', width: 120,
      render: (v: string) => v?.split('T')[0]
    },
    { title: 'CPU', dataIndex: 'cpu_cores', width: 80 },
    { title: '内存(GB)', dataIndex: 'memory_gb', width: 100 },
    { title: '存储(GB)', dataIndex: 'storage_gb', width: 100 },
    { title: 'GPU', dataIndex: 'gpu_count', width: 80 },
    { title: 'GPU型号', dataIndex: 'gpu_type', width: 150, render: (v: string) => v || '-' },
    { title: '单价', dataIndex: 'unit_price', width: 80, render: (v: string) => `¥${v}` },
    { title: '当日费用', dataIndex: 'daily_cost', width: 100, render: (v: string) => <strong>¥{v}</strong> }
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="账单记录数" value={totalDays} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="总费用" value={totalCost} prefix="¥" precision={2} /></Card>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])}
          />
          <Select
            style={{ width: 200 }}
            placeholder="选择项目"
            allowClear
            value={selectedProject}
            onChange={setSelectedProject}
          >
            {projectList.map(p => (
              <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
            ))}
          </Select>
          <Button type="primary" onClick={loadBills} icon={<ReloadOutlined />}>查询</Button>
          <Button onClick={() => handleExport('day')} icon={<DownloadOutlined />}>按天导出</Button>
          <Button onClick={() => handleExport('month')} icon={<DownloadOutlined />}>按月导出</Button>
          <Button onClick={() => handleExport('quarter')} icon={<DownloadOutlined />}>最近三月</Button>
          {isAdmin && (
            <Button type="dashed" onClick={handleGenerate}>生成今日账单</Button>
          )}
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={bills}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 20 }}
      />
    </div>
  );
}
