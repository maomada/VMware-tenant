import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Descriptions, Table, Tag, Button, message, Space, Modal, Form, Input, Spin, Select } from 'antd';
import { admin, resourceRequests } from '../../api';

const statusColors: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  deploying: 'blue',
  deployed: 'green',
  rejected: 'red',
  failed: 'red'
};

export default function AdminResourceRequestDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [approveModal, setApproveModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [deployModal, setDeployModal] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [deployForm] = Form.useForm();

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await resourceRequests.get(Number(id));
      setData(res.data);
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Failed to load request');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const submitApprove = async () => {
    if (!data?.id) return;
    try {
      const values = await approveForm.validateFields();
      await admin.approveResourceRequest(data.id, values);
      message.success('Request approved');
      setApproveModal(false);
      approveForm.resetFields();
      load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Approve failed');
    }
  };

  const submitReject = async () => {
    if (!data?.id) return;
    try {
      const values = await rejectForm.validateFields();
      await admin.rejectResourceRequest(data.id, values);
      message.success('Request rejected');
      setRejectModal(false);
      rejectForm.resetFields();
      load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Reject failed');
    }
  };

  const openDeployModal = () => {
    if (!data?.vm_items?.length) return;
    const vmConfigs = data.vm_items.map((item: any) => ({
      vm_item_id: item.id,
      vm_name: item.vm_name || `${data.request_number}-${item.id}`,
      template_name: item.template_name,
      datastore: []
    }));
    deployForm.setFieldsValue({ vm_configs: vmConfigs });
    setDeployModal(true);
  };

  const submitDeploy = async () => {
    if (!data?.id) return;
    try {
      const values = await deployForm.validateFields();
      setDeploying(true);
      const vmConfigs = (values.vm_configs || []).map((cfg: any) => ({
        ...cfg,
        datastore: Array.isArray(cfg.datastore) ? cfg.datastore[0] : cfg.datastore
      }));
      await admin.deployResourceRequest(data.id, { vm_configs: vmConfigs });
      message.success('Deployment started');
      setDeployModal(false);
      deployForm.resetFields();
      load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.response?.data?.error || 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  const vmColumns = [
    { title: 'VM Name', dataIndex: 'vm_name', render: (v: string) => v || '-' },
    { title: 'Template', dataIndex: 'template_name' },
    { title: 'CPU', dataIndex: 'cpu_cores' },
    { title: 'Memory (GB)', dataIndex: 'memory_gb' },
    { title: 'Disk (GB)', dataIndex: 'disk_gb' },
    { title: 'GPU', dataIndex: 'requires_gpu', render: (v: boolean, record: any) => (v ? `${record.gpu_model || ''} x${record.gpu_count || 0}` : 'No') },
    { title: 'IP', dataIndex: 'ip_address', render: (v: string) => v || '-' },
    { title: 'Network', dataIndex: 'network_segment', render: (v: string) => v || '-' },
    { title: 'Gateway', dataIndex: 'gateway', render: (v: string) => v || '-' },
    { title: 'DNS', dataIndex: 'dns_servers', render: (v: string[]) => (v && v.length ? v.join(', ') : '-') },
    { title: 'Deploy Status', dataIndex: 'deployment_status', render: (v: string) => v || '-' },
    { title: 'Deploy Error', dataIndex: 'deployment_error', render: (v: string) => v || '-' },
    { title: 'Deployed At', dataIndex: 'deployed_at', render: (v: string) => (v ? new Date(v).toLocaleString() : '-') }
  ];

  if (loading && !data) {
    return <Spin />;
  }

  if (!data) {
    return null;
  }

  const templateOptions = Array.from(new Set((data.vm_items || []).map((item: any) => item.template_name)))
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => ({ label: name, value: name }));

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/admin/resource-requests">
          <Button>Back</Button>
        </Link>
        {data.status === 'pending' && (
          <>
            <Button type="primary" onClick={() => setApproveModal(true)}>Approve</Button>
            <Button danger onClick={() => setRejectModal(true)}>Reject</Button>
          </>
        )}
        {data.status === 'approved' && (
          <Button type="primary" onClick={openDeployModal}>Deploy</Button>
        )}
        <Link to={`/admin/resource-requests/${data.id}/deployment-logs`}>
          <Button>Deployment Logs</Button>
        </Link>
      </Space>

      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="Request #">{data.request_number}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={statusColors[data.status] || 'default'}>{data.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Requester">{data.user_name}</Descriptions.Item>
        <Descriptions.Item label="Environment">{data.environment}</Descriptions.Item>
        <Descriptions.Item label="Project">{data.project_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="Purpose" span={2}>{data.purpose}</Descriptions.Item>
        <Descriptions.Item label="Approver">{data.approver_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="Approved At">{data.approved_at ? new Date(data.approved_at).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="Deployed At">{data.deployed_at ? new Date(data.deployed_at).toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="Created At">{new Date(data.created_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Updated At">{new Date(data.updated_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="Admin Notes" span={2}>{data.admin_notes || '-'}</Descriptions.Item>
        <Descriptions.Item label="Rejection Reason" span={2}>{data.rejection_reason || '-'}</Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 24 }}>
        <Table
          columns={vmColumns}
          dataSource={data.vm_items || []}
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </div>

      <Modal
        title="Approve Request"
        open={approveModal}
        onCancel={() => { setApproveModal(false); approveForm.resetFields(); }}
        onOk={submitApprove}
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Reject Request"
        open={rejectModal}
        onCancel={() => { setRejectModal(false); rejectForm.resetFields(); }}
        onOk={submitReject}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="rejection_reason"
            label="Rejection Reason"
            rules={[{ required: true, message: 'Rejection reason is required' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="admin_notes" label="Admin Notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Deploy Request"
        open={deployModal}
        confirmLoading={deploying}
        onCancel={() => { setDeployModal(false); deployForm.resetFields(); }}
        onOk={submitDeploy}
        width={900}
      >
        <Form form={deployForm} layout="vertical">
          <Table
            dataSource={data.vm_items || []}
            rowKey="id"
            pagination={false}
            columns={[
              { title: 'VM Item', dataIndex: 'id' },
              {
                title: 'VM Name',
                render: (_: any, record: any, index: number) => (
                  <>
                    <Form.Item name={['vm_configs', index, 'vm_item_id']} initialValue={record.id} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name={['vm_configs', index, 'vm_name']}
                      rules={[{ required: true, message: 'VM name is required' }]}
                      initialValue={record.vm_name || `${data.request_number}-${record.id}`}
                    >
                      <Input />
                    </Form.Item>
                  </>
                )
              },
              {
                title: 'Template',
                render: (_: any, record: any, index: number) => (
                  <Form.Item
                    name={['vm_configs', index, 'template_name']}
                    rules={[{ required: true, message: 'Template is required' }]}
                    initialValue={record.template_name}
                  >
                    <Select
                      showSearch
                      options={templateOptions}
                    />
                  </Form.Item>
                )
              },
              {
                title: 'Datastore',
                render: (_: any, _record: any, index: number) => (
                  <Form.Item
                    name={['vm_configs', index, 'datastore']}
                    rules={[{ required: true, message: 'Datastore is required' }]}
                  >
                    <Select mode="tags" maxCount={1} placeholder="Datastore" />
                  </Form.Item>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
