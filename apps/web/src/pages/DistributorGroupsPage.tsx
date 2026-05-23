import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { adminApi } from '../api/modules';
import type { AdminUser, DistributorGroup } from '../api/types';

type GroupForm = { code: string; name: string; description?: string | null };

function normalizeSkus(text: string): string[] {
  return Array.from(
    new Set(
      String(text ?? '')
        .split(/\r?\n|,|;/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );
}

export function DistributorGroupsPage() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DistributorGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DistributorGroup | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [form] = Form.useForm<GroupForm>();

  const [allDistributors, setAllDistributors] = useState<AdminUser[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [membersSaving, setMembersSaving] = useState(false);

  const [productsLoading, setProductsLoading] = useState(false);
  const [productsText, setProductsText] = useState('');
  const [productsSaving, setProductsSaving] = useState(false);

  const loadGroups = async () => {
    setLoading(true);
    try {
      const res = await adminApi.distributorGroups();
      setGroups(res);
      if (!selectedGroupId && res.length) setSelectedGroupId(res[0].id);
      if (selectedGroupId && res.every((g) => g.id !== selectedGroupId)) {
        setSelectedGroupId(res.length ? res[0].id : null);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载分组失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadDistributors = async () => {
    try {
      const res = await adminApi.users({ role: 'DISTRIBUTOR', page: 1, pageSize: 2000 });
      setAllDistributors(res.items);
    } catch {}
  };

  const loadMembers = async (groupId: string) => {
    setMembersLoading(true);
    try {
      const res = await adminApi.distributorGroupMembers(groupId);
      setMemberIds(res.filter((u) => u.role === 'DISTRIBUTOR').map((u) => u.id));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载成员失败';
      message.error(msg);
    } finally {
      setMembersLoading(false);
    }
  };

  const loadProducts = async (groupId: string) => {
    setProductsLoading(true);
    try {
      const res = await adminApi.distributorGroupProducts(groupId);
      setProductsText(res.join('\n'));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '加载商品失败';
      message.error(msg);
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
    void loadDistributors();
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;
    void loadMembers(selectedGroupId);
    void loadProducts(selectedGroupId);
  }, [selectedGroupId]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (g: DistributorGroup) => {
    setEditing(g);
    form.resetFields();
    form.setFieldsValue({
      code: g.code,
      name: g.name,
      description: g.description ?? null,
    });
    setModalOpen(true);
  };

  const submitGroup = async () => {
    const values = await form.validateFields();
    setSavingGroup(true);
    try {
      if (!editing) {
        await adminApi.createDistributorGroup(values);
        message.success('创建成功');
      } else {
        await adminApi.updateDistributorGroup(editing.id, values);
        message.success('更新成功');
      }
      setModalOpen(false);
      setEditing(null);
      await loadGroups();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败';
      message.error(msg);
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = async (g: DistributorGroup) => {
    Modal.confirm({
      title: '确认删除分组？',
      content: `${g.code} / ${g.name}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await adminApi.deleteDistributorGroup(g.id);
          message.success('删除成功');
          await loadGroups();
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败';
          message.error(msg);
        }
      },
    });
  };

  const saveMembers = async () => {
    if (!selectedGroupId) return;
    setMembersSaving(true);
    try {
      await adminApi.setDistributorGroupMembers(selectedGroupId, memberIds);
      message.success('成员已保存');
      await loadMembers(selectedGroupId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败';
      message.error(msg);
    } finally {
      setMembersSaving(false);
    }
  };

  const saveProducts = async () => {
    if (!selectedGroupId) return;
    setProductsSaving(true);
    try {
      const skus = normalizeSkus(productsText);
      const res = await adminApi.setDistributorGroupProducts(selectedGroupId, skus);
      if (res.missing?.length) {
        message.warning(`有 ${res.missing.length} 个 SKU 未找到，已忽略`);
      } else {
        message.success('商品已保存');
      }
      await loadProducts(selectedGroupId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败';
      message.error(msg);
    } finally {
      setProductsSaving(false);
    }
  };

  const groupOptions = useMemo(
    () => groups.map((g) => ({ value: g.id, label: `${g.code} / ${g.name}` })),
    [groups],
  );

  const groupColumns = useMemo((): ColumnsType<DistributorGroup> =>
      [
        { title: 'Code', dataIndex: 'code', key: 'code', width: 140 },
        { title: '名称', dataIndex: 'name', key: 'name', width: 220 },
        {
          title: '说明',
          dataIndex: 'description',
          key: 'description',
          render: (v: string | null | undefined) => v || <span style={{ color: '#999' }}>—</span>,
        },
        {
          title: '操作',
          key: 'actions',
          width: 160,
          render: (_: unknown, g: DistributorGroup) => (
            <Space>
              <Button size="small" onClick={() => openEdit(g)}>
                编辑
              </Button>
              <Button size="small" danger onClick={() => void deleteGroup(g)}>
                删除
              </Button>
            </Space>
          ),
        },
      ],
    [groups],
  );

  const distributorColumns = useMemo((): ColumnsType<AdminUser> =>
      [
        { title: '账号', dataIndex: 'email', key: 'email' },
        { title: '姓名', dataIndex: 'displayName', key: 'displayName', width: 180, render: (v: string | null) => v || <span style={{ color: '#999' }}>—</span> },
        { title: '手机号', dataIndex: 'phone', key: 'phone', width: 160, render: (v: string | null) => v || <span style={{ color: '#999' }}>—</span> },
      ],
    [],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card variant="borderless">
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            分销商分组与商品可见性
          </Typography.Title>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void loadGroups()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建分组
            </Button>
          </Space>
        </Space>
      </Card>

      <Card variant="borderless">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <span>当前分组</span>
            <Select
              style={{ width: 320 }}
              value={selectedGroupId}
              onChange={(v) => setSelectedGroupId(v)}
              options={groupOptions}
              placeholder="请选择分组"
            />
          </Space>
        </Space>
      </Card>

      <Tabs
        items={[
          {
            key: 'groups',
            label: '分组管理',
            children: (
              <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                <Table rowKey="id" loading={loading} dataSource={groups} columns={groupColumns} pagination={false} />
              </Card>
            ),
          },
          {
            key: 'members',
            label: '分组成员',
            children: (
              <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                <div style={{ padding: 16 }}>
                  <Space>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      disabled={!selectedGroupId}
                      loading={membersSaving}
                      onClick={() => void saveMembers()}
                    >
                      保存成员
                    </Button>
                  </Space>
                </div>
                <Table
                  rowKey="id"
                  loading={membersLoading}
                  dataSource={allDistributors}
                  columns={distributorColumns}
                  pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500] }}
                  rowSelection={{
                    selectedRowKeys: memberIds,
                    onChange: (keys) => setMemberIds(keys.map(String)),
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'products',
            label: '可见商品',
            children: (
              <Card variant="borderless">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      disabled={!selectedGroupId}
                      loading={productsLoading || productsSaving}
                      onClick={() => void saveProducts()}
                    >
                      保存 SKU（覆盖）
                    </Button>
                    <Upload
                      accept=".xlsx"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        if (!selectedGroupId) return false;
                        void (async () => {
                          try {
                            const res = await adminApi.importDistributorGroupProductsXlsx(selectedGroupId, file, 'replace');
                            if (res.missing?.length) {
                              message.warning(`有 ${res.missing.length} 个 SKU 未找到，已忽略`);
                            } else {
                              message.success('导入成功');
                            }
                            await loadProducts(selectedGroupId);
                          } catch (err: unknown) {
                            const msg =
                              (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败';
                            message.error(msg);
                          }
                        })();
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} disabled={!selectedGroupId} loading={productsLoading}>
                        导入 Excel（覆盖）
                      </Button>
                    </Upload>
                  </Space>
                  <Input.TextArea
                    value={productsText}
                    onChange={(e) => setProductsText(e.target.value)}
                    placeholder="每行一个 SKU"
                    autoSize={{ minRows: 12, maxRows: 24 }}
                    disabled={!selectedGroupId || productsLoading}
                  />
                  <Typography.Text type="secondary">
                    规则：商品未分配到任何分组时，默认所有分销商可见；商品分配到分组后，仅该分组成员可见。
                  </Typography.Text>
                </Space>
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={modalOpen}
        title={editing ? '编辑分组' : '新建分组'}
        onCancel={() => setModalOpen(false)}
        onOk={submitGroup}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingGroup}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Code" rules={[{ required: true, message: '请输入 code' }]}>
            <Input placeholder="例如: VIP / A / B" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如: VIP 分销商" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
