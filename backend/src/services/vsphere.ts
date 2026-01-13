import axios, { AxiosInstance } from 'axios';
import https from 'https';

class VSphereService {
  private client: AxiosInstance;
  private sessionId: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.VCENTER_URL,
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
  }

  async authenticate(): Promise<void> {
    const res = await this.client.post('/api/session', {}, {
      auth: { username: process.env.VCENTER_USER!, password: process.env.VCENTER_PASSWORD! }
    });
    this.sessionId = res.data;
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
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/folder', {
      headers: this.headers,
      params: { 'filter.names': folderName, 'filter.type': 'VIRTUAL_MACHINE' }
    });
    return res.data?.[0]?.folder || null;
  }

  async getVMsByFolder(folderId: string) {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/vm', {
      headers: this.headers,
      params: { 'filter.folders': folderId }
    });
    return res.data;
  }
}

export const vsphere = new VSphereService();
