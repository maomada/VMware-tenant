import axios, { AxiosInstance } from 'axios';
import https from 'https';

class VSphereService {
  private client: AxiosInstance;
  private soapClient: AxiosInstance;
  private sessionId: string | null = null;
  private soapSessionId: string | null = null;

  constructor() {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    this.client = axios.create({
      baseURL: process.env.VCENTER_URL,
      httpsAgent
    });
    this.soapClient = axios.create({
      baseURL: process.env.VCENTER_URL,
      httpsAgent,
      headers: { 'Content-Type': 'text/xml' }
    });
  }

  async authenticate(): Promise<void> {
    const res = await this.client.post('/api/session', {}, {
      auth: { username: process.env.VCENTER_USER!, password: process.env.VCENTER_PASSWORD! }
    });
    this.sessionId = res.data;
  }

  private async soapLogin(): Promise<void> {
    const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Login>
      <urn:_this type="SessionManager">SessionManager</urn:_this>
      <urn:userName>${process.env.VCENTER_USER}</urn:userName>
      <urn:password>${process.env.VCENTER_PASSWORD}</urn:password>
    </urn:Login>
  </soapenv:Body>
</soapenv:Envelope>`;
    const res = await this.soapClient.post('/sdk', loginXml);
    const match = res.headers['set-cookie']?.find((c: string) => c.includes('vmware_soap_session'));
    this.soapSessionId = match?.split(';')[0] || null;
  }

  private get headers() {
    return { 'vmware-api-session-id': this.sessionId };
  }

  async listVMs() {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/vm', { headers: this.headers });
    return res.data;
  }

  async getVM(vmId: string) {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get(`/api/vcenter/vm/${vmId}`, { headers: this.headers });
    return res.data;
  }

  async powerOn(vmId: string) {
    if (!this.sessionId) await this.authenticate();
    await this.client.post(`/api/vcenter/vm/${vmId}/power?action=start`, {}, { headers: this.headers });
  }

  async powerOff(vmId: string) {
    if (!this.sessionId) await this.authenticate();
    await this.client.post(`/api/vcenter/vm/${vmId}/power?action=stop`, {}, { headers: this.headers });
  }

  async getPowerState(vmId: string) {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get(`/api/vcenter/vm/${vmId}/power`, { headers: this.headers });
    return res.data;
  }

  async getFolderByName(folderName: string): Promise<string | null> {
    try {
      if (!this.sessionId) await this.authenticate();
      const res = await this.client.get('/api/vcenter/folder', { headers: this.headers });
      const folder = res.data?.find((f: any) => f.name === folderName && f.type === 'VIRTUAL_MACHINE');
      return folder?.folder || null;
    } catch (err) {
      console.error('getFolderByName error:', err);
      return null;
    }
  }

  // 获取指定 folder 名称下的所有 VM（使用 SOAP API）
  async getVMsByFolderName(folderName: string): Promise<any[]> {
    try {
      console.log(`[vSphere] getVMsByFolderName: ${folderName}`);
      if (!this.soapSessionId) await this.soapLogin();
      if (!this.sessionId) await this.authenticate();

      // 获取所有 VM
      const allVMs = await this.listVMs();
      console.log(`[vSphere] Total VMs: ${allVMs.length}`);

      // 使用 SOAP PropertyCollector 获取每个 VM 的 parent folder 链
      const vmsWithPath = await Promise.all(
        allVMs.map(async (vm: any) => {
          try {
            const path = await this.getVMInventoryPath(vm.vm);
            return { ...vm, folderPath: path };
          } catch {
            return { ...vm, folderPath: '' };
          }
        })
      );

      // 过滤出路径中包含指定 folder 名称的 VM
      const filtered = vmsWithPath.filter((vm: any) => vm.folderPath.includes(`/${folderName}/`));
      console.log(`[vSphere] Filtered VMs: ${filtered.length}`);
      if (filtered.length > 0) {
        console.log(`[vSphere] Sample path: ${filtered[0].folderPath}`);
      }
      return filtered;
    } catch (err) {
      console.error('getVMsByFolderName error:', err);
      return [];
    }
  }

  // 获取指定 folder 路径下的所有 VM（使用 SOAP API）
  async getVMsByFolderPath(folderPath: string): Promise<any[]> {
    try {
      if (!this.soapSessionId) await this.soapLogin();
      if (!this.sessionId) await this.authenticate();

      // 获取所有 VM
      const allVMs = await this.listVMs();

      // 使用 SOAP PropertyCollector 获取每个 VM 的 parent folder 链
      const vmsWithPath = await Promise.all(
        allVMs.map(async (vm: any) => {
          try {
            const path = await this.getVMInventoryPath(vm.vm);
            return { ...vm, folderPath: path };
          } catch {
            return { ...vm, folderPath: '' };
          }
        })
      );

      // 过滤出指定 folder 路径下的 VM
      return vmsWithPath.filter((vm: any) => vm.folderPath.startsWith(folderPath));
    } catch (err) {
      console.error('getVMsByFolderPath error:', err);
      return [];
    }
  }

  // 获取 VM 的完整 inventory 路径
  private async getVMInventoryPath(vmId: string): Promise<string> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>parent</urn:pathSet>
          <urn:pathSet>name</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    const res = await this.soapClient.post('/sdk', xml, {
      headers: { Cookie: this.soapSessionId || '' }
    });

    // 解析响应获取 parent folder，然后递归获取完整路径
    const parentMatch = res.data.match(/<val[^>]*type="Folder"[^>]*>([^<]+)<\/val>/);
    const nameMatch = res.data.match(/<name>name<\/name><val[^>]*>([^<]+)<\/val>/);

    if (parentMatch && nameMatch) {
      const parentPath = await this.getFolderPath(parentMatch[1]);
      return `${parentPath}/${nameMatch[1]}`;
    }
    return nameMatch?.[1] || '';
  }

  // 递归获取 folder 路径
  private async getFolderPath(folderId: string): Promise<string> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>Folder</urn:type>
          <urn:pathSet>parent</urn:pathSet>
          <urn:pathSet>name</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="Folder">${folderId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    const res = await this.soapClient.post('/sdk', xml, {
      headers: { Cookie: this.soapSessionId || '' }
    });

    // parent 可能是 Folder 或 Datacenter
    const parentFolderMatch = res.data.match(/<val[^>]*type="Folder"[^>]*>([^<]+)<\/val>/);
    const nameMatch = res.data.match(/<name>name<\/name><val[^>]*>([^<]+)<\/val>/);

    if (parentFolderMatch && nameMatch) {
      const parentPath = await this.getFolderPath(parentFolderMatch[1]);
      return `${parentPath}/${nameMatch[1]}`;
    }
    return nameMatch?.[1] ? `/${nameMatch[1]}` : '';
  }

  // 兼容旧接口，但使用新的路径匹配逻辑
  async getVMsByFolder(folderId: string) {
    try {
      console.log(`[vSphere] getVMsByFolder: ${folderId}`);
      if (!this.sessionId) await this.authenticate();
      // 先尝试 REST API
      const res = await this.client.get('/api/vcenter/vm', {
        headers: this.headers,
        params: { 'filter.folders': folderId }
      });
      console.log(`[vSphere] REST API success, VMs: ${res.data?.length}`);
      return res.data;
    } catch (err: any) {
      // 如果 REST API 不支持，回退到 SOAP API
      if (err.response?.status === 400) {
        console.log(`[vSphere] REST API not supported, falling back to SOAP`);
        const folders = await this.client.get('/api/vcenter/folder', { headers: this.headers });
        const folder = folders.data?.find((f: any) => f.folder === folderId);
        if (folder) {
          console.log(`[vSphere] Found folder: ${folder.name}`);
          return this.getVMsByFolderName(folder.name);
        }
      }
      console.error('getVMsByFolder error:', err);
      return [];
    }
  }
}

export const vsphere = new VSphereService();
