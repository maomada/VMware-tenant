import axios, { AxiosInstance } from 'axios';
import https from 'https';

class VSphereService {
  private client: AxiosInstance;
  private soapClient: AxiosInstance;
  private sessionId: string | null = null;
  private soapSessionId: string | null = null;
  private hostPciDeviceCache: Map<string, string> | null = null;
  private hostPciDeviceCacheAt = 0;

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

  private decodeXml(value: string) {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private async soapRequest(xml: string): Promise<string> {
    if (!this.soapSessionId) await this.soapLogin();
    const res = await this.soapClient.post('/sdk', xml, {
      headers: { Cookie: this.soapSessionId || '' }
    });
    return res.data;
  }

  private async listHosts(): Promise<string[]> {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/host', { headers: this.headers });
    return (res.data || []).map((h: any) => h.host).filter(Boolean);
  }

  private parseHostPciDevices(xml: string) {
    const devices: { id: string; deviceName: string | null }[] = [];
    const blockRegex = /<HostPciDevice(?:\s[^>]*)?>([\s\S]*?)<\/HostPciDevice>/g;
    const valRegex = /<val[^>]*xsi:type="HostPciDevice"[^>]*>([\s\S]*?)<\/val>/g;

    const parseBlock = (block: string) => {
      const idMatch = block.match(/<id>([^<]+)<\/id>/);
      const nameMatch = block.match(/<deviceName>([^<]+)<\/deviceName>/);
      if (!idMatch) return;
      devices.push({
        id: this.decodeXml(idMatch[1]),
        deviceName: nameMatch ? this.decodeXml(nameMatch[1]) : null
      });
    };

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(xml)) !== null) {
      parseBlock(match[1]);
    }
    while ((match = valRegex.exec(xml)) !== null) {
      parseBlock(match[1]);
    }

    return devices;
  }

  private async getHostPciDeviceMap() {
    const now = Date.now();
    if (this.hostPciDeviceCache && now - this.hostPciDeviceCacheAt < 5 * 60 * 1000) {
      return this.hostPciDeviceCache;
    }

    const hostIds = await this.listHosts();
    const deviceMap = new Map<string, string>();

    for (const hostId of hostIds) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>HostSystem</urn:type>
          <urn:pathSet>hardware.pciDevice</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="HostSystem">${hostId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

      const data = await this.soapRequest(xml);
      const devices = this.parseHostPciDevices(data);
      for (const device of devices) {
        if (device.deviceName) {
          deviceMap.set(`${hostId}:${device.id}`, device.deviceName);
        }
      }
    }

    this.hostPciDeviceCache = deviceMap;
    this.hostPciDeviceCacheAt = now;
    return deviceMap;
  }

  private extractPassthroughDevices(xml: string) {
    const devices: { id: string | null; deviceName: string | null }[] = [];
    const typedPassthroughRegex = /<([A-Za-z0-9:_-]+)[^>]*xsi:type="[^"]*VirtualPCIPassthrough[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
    const passthroughRegex = /<VirtualPCIPassthrough[^>]*>([\s\S]*?)<\/VirtualPCIPassthrough>/g;

    const parseBlock = (block: string) => {
      const backingMatch = block.match(/<backing[\s\S]*?<\/backing>/);
      const source = backingMatch ? backingMatch[0] : block;
      const idMatch = source.match(/<id>([^<]+)<\/id>/);
      const nameMatch = source.match(/<deviceName>([^<]+)<\/deviceName>/);
      const vgpuMatch = source.match(/<vgpu>([^<]+)<\/vgpu>/);
      devices.push({
        id: idMatch ? this.decodeXml(idMatch[1]) : null,
        deviceName: nameMatch
          ? this.decodeXml(nameMatch[1])
          : vgpuMatch
            ? this.decodeXml(vgpuMatch[1])
            : null
      });
    };

    let match: RegExpExecArray | null;
    while ((match = typedPassthroughRegex.exec(xml)) !== null) {
      parseBlock(match[2]);
    }
    while ((match = passthroughRegex.exec(xml)) !== null) {
      parseBlock(match[1]);
    }

    const deduped: { id: string | null; deviceName: string | null }[] = [];
    const seen = new Set<string>();
    for (const device of devices) {
      const key = `${device.id || ''}:${device.deviceName || ''}`;
      if (device.id || device.deviceName) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(device);
    }

    return deduped;
  }

  async getVmGpuInfo(vmId: string): Promise<{ gpuCount: number; gpuType: string | null }> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>config.hardware.device</urn:pathSet>
          <urn:pathSet>runtime.host</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.soapRequest(xml);
    const debug = process.env.VSPHERE_GPU_DEBUG === '1';
    const hostMatch = data.match(/<name>runtime\.host<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    const hostRef = hostMatch ? this.decodeXml(hostMatch[1]) : null;

    const passthroughDevices = this.extractPassthroughDevices(data);
    const gpuCount = passthroughDevices.length;
    if (debug) {
      console.log(`[vSphere] GPU debug vm=${vmId} host=${hostRef || 'n/a'} passthrough=${gpuCount}`);
    }
    if (!gpuCount) {
      return { gpuCount: 0, gpuType: null };
    }

    const gpuTypes: string[] = [];
    const needsHostMap = passthroughDevices.some((device) => !device.deviceName && device.id);
    let hostMap: Map<string, string> | null = null;
    if (needsHostMap && hostRef) {
      try {
        hostMap = await this.getHostPciDeviceMap();
      } catch (err) {
        console.warn('[vSphere] Host PCI device query failed:', err);
      }
    }
    for (const device of passthroughDevices) {
      let name = device.deviceName;
      if (!name && hostRef && device.id && hostMap) {
        name = hostMap.get(`${hostRef}:${device.id}`) || null;
      }
      if (name) {
        gpuTypes.push(name);
      }
    }

    const uniqueTypes = Array.from(new Set(gpuTypes));
    if (debug) {
      console.log(`[vSphere] GPU debug vm=${vmId} types=${uniqueTypes.join(', ') || 'unknown'}`);
    }
    return { gpuCount, gpuType: uniqueTypes.length ? uniqueTypes.join(', ') : null };
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
