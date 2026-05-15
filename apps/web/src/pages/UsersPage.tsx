import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/modules';
import type { AdminUser } from '../api/types';
import type { ColumnsType } from 'antd/es/table';

type Role = 'ADMIN' | 'DISTRIBUTOR';

export function UsersPage() {
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const loadList = async (
    p = page,
    ps = pageSize,
    keyword = q,
    r = role,
  ) => {
    const qp = new URLSearchParams();
    if (keyword.trim()) qp.set('q', keyword.trim());
    if (r) qp.set('role', r);
    if (p > 1) qp.set('page', String(p));
    if (ps !== 20) qp.set('pageSize', String(ps));
    setSearchParams(qp, { replace: true });

    setLoading(true);
    try {
      const res = await adminApi.users({ q: keyword.trim() || undefined, role: r, page: p, pageSize: ps });
      setData(res.items);
      setTotal(res.total);
      setPage(res.page);
      setPageSize(res.pageSize);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载用户失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initQ = searchParams.get('q') ?? '';
    const initRole = (searchParams.get('role') ?? '').toUpperCase();
    const initRoleTyped = initRole === 'ADMIN' || initRole === 'DISTRIBUTOR' ? (initRole as Role) : undefined;
    const initPage = Math.max(1, Number(searchParams.get('page') ?? 1));
    const initPageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));

    setQ(initQ);
    setRole(initRoleTyped);
    loadList(initPage, initPageSize, initQ, initRoleTyped);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'DISTRIBUTOR' });
    setModalOpen(true);
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    form.resetFields();
    form.setFieldsValue({
      email: u.email,
      phone: u.phone ?? '',
      displayName: u.displayName ?? '',
      role: u.role,
      password: '',
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (!editing) {
        await adminApi.createUser({
          email: values.email,
          phone: values.phone?.trim() ? values.phone.trim() : undefined,
          displayName: values.displayName?.trim() ? values.displayName.trim() : undefined,
          password: values.password,
          role: values.role,
        });
        message.success('创建成功');
      } else {
        await adminApi.updateUser(editing.id, {
          email: values.email,
          phone: values.phone ?? '',
          displayName: values.displayName ?? '',
          role: values.role,
          ...(values.password?.trim() ? { password: values.password } : {}),
        });
        message.success('更新成功');
      }
      setModalOpen(false);
      setEditing(null);
      await loadList(1, pageSize, q, role);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (u: AdminUser) => {
    Modal.confirm({
      title: '确认删除用户？',
      content: `${u.email}${u.phone ? ` (${u.phone})` : ''}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await adminApi.deleteUser(u.id);
          message.success('删除成功');
          await loadList(1, pageSize, q, role);
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败';
          message.error(msg);
        }
      },
    });
  };

  const columns = useMemo((): ColumnsType<AdminUser> =>
      [
        {
          title: '账号',
          dataIndex: 'email',
          key: 'email',
          render: (v: string) => <Typography.Text copyable>{v}</Typography.Text>,
        },
        {
          title: '手机号',
          dataIndex: 'phone',
          key: 'phone',
          width: 150,
          render: (v: string | null) => (v ? <Typography.Text copyable>{v}</Typography.Text> : <span style={{ color: '#999' }}>—</span>),
        },
        {
          title: '姓名',
          dataIndex: 'displayName',
          key: 'displayName',
          width: 180,
          render: (v: string | null) => v || <span style={{ color: '#999' }}>—</span>,
        },
        {
          title: '角色',
          dataIndex: 'role',
          key: 'role',
          width: 120,
          render: (v: Role) => (v === 'ADMIN' ? <Tag color="geekblue">ADMIN</Tag> : <Tag>DISTRIBUTOR</Tag>),
        },
        {
          title: '创建时间',
          dataIndex: 'createdAt',
          key: 'createdAt',
          width: 170,
          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
        },
        {
          title: '操作',
          key: 'actions',
          width: 180,
          render: (_: unknown, u: AdminUser) => (
            <Space>
              <Button size="small" onClick={() => openEdit(u)}>
                编辑
              </Button>
              <Button size="small" danger onClick={() => onDelete(u)}>
                删除
              </Button>
            </Space>
          ),
        },
      ],
    [q, role, pageSize],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card variant="borderless">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              用户管理
            </Typography.Title>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => loadList(1, pageSize, q, role)}>
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建用户
              </Button>
            </Space>
          </Space>

          <Space wrap>
            <Input
              placeholder="搜索邮箱/手机号/姓名"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onPressEnter={() => loadList(1, pageSize, q, role)}
              style={{ width: 260 }}
              allowClear
            />
            <Select
              placeholder="角色"
              allowClear
              value={role}
              onChange={(v) => setRole(v)}
              style={{ width: 160 }}
              options={[
                { value: 'ADMIN', label: 'ADMIN' },
                { value: 'DISTRIBUTOR', label: 'DISTRIBUTOR' },
              ]}
            />
            <Button type="primary" onClick={() => loadList(1, pageSize, q, role)}>
              查询
            </Button>
          </Space>
        </Space>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => loadList(p, ps, q, role),
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={submit}
        okText="保存"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ role: 'DISTRIBUTOR' }}>
          <Form.Item label="账号（邮箱/用户名）" name="email" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="例如：admin / user@example.com" />
          </Form.Item>

          <Form.Item label="手机号" name="phone">
            <Input placeholder="仅数字或任意格式（会自动提取数字）" />
          </Form.Item>

          <Form.Item label="姓名" name="displayName">
            <Input placeholder="显示名称" />
          </Form.Item>

          <Form.Item label="角色" name="role" rules={[{ required: true }]}> 
            <Select
              options={[
                { value: 'DISTRIBUTOR', label: 'DISTRIBUTOR（分销商）' },
                { value: 'ADMIN', label: 'ADMIN（管理员）' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label={editing ? '重置密码（可选）' : '密码'}
            name="password"
            rules={editing ? [] : [{ required: true, min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder={editing ? '留空则不修改' : '至少 6 位'} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
