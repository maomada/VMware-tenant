import axios, { AxiosInstance } from 'axios';
import https from 'https';

class VSphereService {
  private client: AxiosInstance;
  private soapClient: AxiosInstance;
  private sessionId: string | null = null;
  private soapSessionId: string | null = null;
  private hostPciDeviceCache: Map<string, string> | null = null;
  private hostPciDeviceCacheAt = 0;
  private customFieldCache: Map<string, string> | null = null;
  private customFieldCacheAt = 0;

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

    const debug = process.env.VSPHERE_GPU_DEBUG === '1';
    const hostIds = await this.listHosts();
    const deviceMap = new Map<string, string>();

    for (const hostId of hostIds) {
      if (debug) {
        console.log(`[vSphere] GPU debug host=${hostId} query pci devices`);
      }
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
        if (debug) {
          console.log(
            `[vSphere] GPU debug host=${hostId} pci id=${device.id} name=${device.deviceName || 'n/a'}`
          );
          if (device.deviceName && /geforce|tesla/i.test(device.deviceName)) {
            console.log(
              `[vSphere] GPU debug host=${hostId} pci candidate id=${device.id} name=${device.deviceName}`
            );
          }
        }
        if (device.deviceName) {
          deviceMap.set(`${hostId}:${device.id}`, device.deviceName);
        }
      }
    }

    this.hostPciDeviceCache = deviceMap;
    this.hostPciDeviceCacheAt = now;
    return deviceMap;
  }

  private isGpuDeviceName(deviceName: string) {
    return /nvidia|geforce|tesla|quadro|rtx|gtx/i.test(deviceName);
  }

  private extractGpuModelFromDeviceName(deviceName: string) {
    const bracketMatch = deviceName.match(/\[([^\]]+)\]/);
    if (bracketMatch?.[1]) {
      return bracketMatch[1].trim();
    }
    return deviceName.trim();
  }

  private async getHostNameMap() {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/host', { headers: this.headers });
    const hostMap = new Map<string, string>();
    for (const host of res.data || []) {
      if (host.host) {
        hostMap.set(host.host, host.name || host.host);
      }
    }
    return hostMap;
  }

  private async getCustomFieldDefinitions(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.customFieldCache && now - this.customFieldCacheAt < 5 * 60 * 1000) {
      return this.customFieldCache;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>CustomFieldsManager</urn:type>
          <urn:pathSet>field</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="CustomFieldsManager">CustomFieldsManager</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const data = await this.soapRequest(xml);
      const fieldMap = new Map<string, string>();
      const fieldRegex = /<CustomFieldDef[^>]*>([\s\S]*?)<\/CustomFieldDef>/g;
      let match: RegExpExecArray | null;
      while ((match = fieldRegex.exec(data)) !== null) {
        const block = match[1];
        const keyMatch = block.match(/<key>(\d+)<\/key>/);
        const nameMatch = block.match(/<name>([^<]+)<\/name>/);
        if (keyMatch && nameMatch) {
          fieldMap.set(keyMatch[1], this.decodeXml(nameMatch[1]));
        }
      }
      this.customFieldCache = fieldMap;
      this.customFieldCacheAt = now;
      return fieldMap;
    } catch (err) {
      console.warn('[vSphere] Failed to load custom field definitions:', err);
      return new Map();
    }
  }

  private extractPassthroughDevices(xml: string) {
    const devices: { id: string | null; deviceName: string | null }[] = [];
    const debug = process.env.VSPHERE_GPU_DEBUG === '1';

    // Match VirtualPCIPassthrough devices
    const typedPassthroughRegex = /<([A-Za-z0-9:_-]+)[^>]*xsi:type="[^"]*VirtualPCIPassthrough[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
    const passthroughRegex = /<VirtualPCIPassthrough[^>]*>([\s\S]*?)<\/VirtualPCIPassthrough>/g;

    // Match PCI device (label="PCI device X") - GPU passthrough in some vSphere versions
    const pciDeviceRegex = /<VirtualDevice[^>]*xsi:type="VirtualDevice"[^>]*>([\s\S]*?)<\/VirtualDevice>/g;

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

    // Check for PCI device with label "PCI device X"
    while ((match = pciDeviceRegex.exec(xml)) !== null) {
      const block = match[1];
      const labelMatch = block.match(/<label>([^<]+)<\/label>/);
      if (labelMatch && /^PCI device \d+$/i.test(labelMatch[1])) {
        if (debug) {
          console.log(`[vSphere] GPU debug found PCI device: ${labelMatch[1]}`);
        }
        // Mark as PCI passthrough device (will resolve GPU type from host)
        devices.push({
          id: 'pci-passthrough',
          deviceName: null
        });
      }
    }

    const deduped: { id: string | null; deviceName: string | null }[] = [];
    const seen = new Set<string>();
    for (const device of devices) {
      // Don't dedupe pci-passthrough markers - each represents a separate GPU
      if (device.id === 'pci-passthrough') {
        deduped.push(device);
        continue;
      }
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
    if (debug) {
      console.log(`[vSphere] GPU debug vm=${vmId} config.hardware.device xml:\n${data}`);
    }
    const hostMatch = data.match(/<name>runtime\.host<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    const hostRef = hostMatch ? this.decodeXml(hostMatch[1]) : null;
    if (debug) {
      console.log(`[vSphere] GPU debug vm=${vmId} runtime.host=${hostRef || 'n/a'}`);
    }

    const passthroughDevices = this.extractPassthroughDevices(data);
    const gpuCount = passthroughDevices.length;
    if (debug) {
      for (const device of passthroughDevices) {
        console.log(
          `[vSphere] GPU debug vm=${vmId} passthrough backing.id=${device.id || 'n/a'} name=${device.deviceName || 'n/a'}`
        );
      }
      console.log(`[vSphere] GPU debug vm=${vmId} host=${hostRef || 'n/a'} passthrough=${gpuCount}`);
    }
    if (!gpuCount) {
      return { gpuCount: 0, gpuType: null };
    }

    const gpuTypes: string[] = [];
    const hasPciPassthrough = passthroughDevices.some((d) => d.id === 'pci-passthrough');
    const needsHostMap = passthroughDevices.some((device) => !device.deviceName && device.id);

    if (needsHostMap && hostRef) {
      try {
        const hostMap = await this.getHostPciDeviceMap();
        if (debug && hostMap) {
          console.log(
            `[vSphere] GPU debug vm=${vmId} hostMap keys=${Array.from(hostMap.keys()).join(', ') || 'none'}`
          );
        }

        // For pci-passthrough devices, find GPU from host's PCI devices
        if (hasPciPassthrough && hostMap) {
          for (const [key, deviceName] of hostMap.entries()) {
            if (key.startsWith(`${hostRef}:`) && /geforce|tesla|quadro|rtx|gtx/i.test(deviceName)) {
              gpuTypes.push(deviceName);
              if (debug) {
                console.log(`[vSphere] GPU debug vm=${vmId} found GPU from host: ${deviceName}`);
              }
            }
          }
        }

        // For devices with specific IDs
        for (const device of passthroughDevices) {
          if (device.id && device.id !== 'pci-passthrough') {
            const name = device.deviceName || hostMap?.get(`${hostRef}:${device.id}`) || null;
            if (name) {
              gpuTypes.push(name);
            }
          }
        }
      } catch (err) {
        console.warn('[vSphere] Host PCI device query failed:', err);
      }
    }

    // Add any devices that already have names
    for (const device of passthroughDevices) {
      if (device.deviceName) {
        gpuTypes.push(device.deviceName);
      }
    }

    const uniqueTypes = Array.from(new Set(gpuTypes));
    if (debug) {
      console.log(`[vSphere] GPU debug vm=${vmId} types=${uniqueTypes.join(', ') || 'unknown'}`);
    }
    return { gpuCount, gpuType: uniqueTypes.length ? uniqueTypes.join(', ') : null };
  }

  private async loadGpuService() {
    return await import('./gpu');
  }

  async syncGPUInventory() {
    const deviceMap = await this.getHostPciDeviceMap();
    let hostMap = new Map<string, string>();
    try {
      hostMap = await this.getHostNameMap();
    } catch (err) {
      console.warn('[vSphere] Failed to load host names:', err);
    }

    const inventory: {
      deviceId: string;
      deviceName: string;
      gpuModel: string;
      hostId: string;
      hostName: string;
    }[] = [];

    for (const [key, deviceName] of deviceMap.entries()) {
      if (!this.isGpuDeviceName(deviceName)) continue;
      const separatorIndex = key.indexOf(':');
      if (separatorIndex <= 0) continue;
      const hostId = key.slice(0, separatorIndex);
      const deviceId = key.slice(separatorIndex + 1);
      const gpuModel = this.extractGpuModelFromDeviceName(deviceName);
      inventory.push({
        deviceId,
        deviceName,
        gpuModel,
        hostId,
        hostName: hostMap.get(hostId) || hostId
      });
    }

    return inventory;
  }

  async validateGPUAvailability(gpuType: string, count: number) {
    const gpuService = await this.loadGpuService();
    return gpuService.validateGPUAvailability(gpuType, count);
  }

  async reserveGPUs(gpuType: string, count: number) {
    const gpuService = await this.loadGpuService();
    return gpuService.reserveGPUs(gpuType, count);
  }

  async releaseGPUs(gpuIds: string[]) {
    const gpuService = await this.loadGpuService();
    return gpuService.releaseGPUs(gpuIds);
  }

  async getVMMetadata(vmId: string): Promise<{
    createTime: Date | null;
    deadline: Date | null;
    owner: string | null;
  }> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>config.createDate</urn:pathSet>
          <urn:pathSet>customValue</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const data = await this.soapRequest(xml);

      const createDateMatch = data.match(/<name>config\.createDate<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
      let createTime: Date | null = null;
      if (createDateMatch) {
        const dateStr = this.decodeXml(createDateMatch[1]);
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() !== 1970) {
          createTime = parsed;
        }
      }

      const fieldMap = await this.getCustomFieldDefinitions();
      let deadline: Date | null = null;
      let owner: string | null = null;

      const customValueSectionMatch = data.match(/<name>customValue<\/name>\s*<val[^>]*>([\s\S]*?)<\/val>/);
      const customValueSection = customValueSectionMatch?.[1] || '';
      const customValueRegex = /<key>(\d+)<\/key>[\s\S]*?<value[^>]*>([^<]*)<\/value>/g;
      let match: RegExpExecArray | null;
      while ((match = customValueRegex.exec(customValueSection)) !== null) {
        const key = match[1];
        const value = this.decodeXml(match[2]);
        const fieldName = fieldMap.get(key)?.trim().toLowerCase();

        if (fieldName === 'deadline' && value) {
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            deadline = parsed;
          }
        }
        if (fieldName === 'owner' && value) {
          owner = value;
        }
      }

      return { createTime, deadline, owner };
    } catch (err) {
      console.warn(`[vSphere] Failed to fetch metadata for VM ${vmId}:`, err);
      return { createTime: null, deadline: null, owner: null };
    }
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string, retries = 2, delayMs = 1000): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt === retries) break;
        console.warn(`[vSphere] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying...`);
        await this.sleep(delayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  private extractTaskId(xml: string): string | null {
    const taskMatch = xml.match(/<returnval[^>]*type="Task"[^>]*>([^<]+)<\/returnval>/);
    if (taskMatch?.[1]) return this.decodeXml(taskMatch[1]);
    const altMatch = xml.match(/<returnval[^>]*>(task-[^<]+)<\/returnval>/);
    return altMatch?.[1] ? this.decodeXml(altMatch[1]) : null;
  }

  private parseTaskStatus(xml: string) {
    const stateMatch = xml.match(/<name>info\.state<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    const progressMatch = xml.match(/<name>info\.progress<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    const resultMatch = xml.match(/<name>info\.result<\/name>\s*<val[^>]*>([^<]+)<\/val>/);
    const errorMatch = xml.match(/<name>info\.error<\/name>\s*<val[^>]*>([\s\S]*?)<\/val>/);

    let errorMessage: string | undefined;
    if (errorMatch?.[1]) {
      const localized = errorMatch[1].match(/<localizedMessage>([^<]+)<\/localizedMessage>/);
      const fault = errorMatch[1].match(/<faultCause>([\s\S]*?)<\/faultCause>/);
      if (localized?.[1]) {
        errorMessage = this.decodeXml(localized[1]);
      } else if (fault?.[1]) {
        errorMessage = this.decodeXml(fault[1]);
      } else {
        const messageMatch = errorMatch[1].match(/<msg>([^<]+)<\/msg>/);
        if (messageMatch?.[1]) {
          errorMessage = this.decodeXml(messageMatch[1]);
        }
      }
    }

    const state = stateMatch?.[1] ? this.decodeXml(stateMatch[1]) : 'running';
    const progress = progressMatch?.[1] ? Number(progressMatch[1]) : 0;
    const resultId = resultMatch?.[1] ? this.decodeXml(resultMatch[1]) : undefined;

    return {
      status: state as 'queued' | 'running' | 'success' | 'error',
      progress: Number.isFinite(progress) ? progress : 0,
      errorMessage,
      resultId
    };
  }

  private async getVmIdByName(name: string): Promise<string | null> {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/vm', {
      headers: this.headers,
      params: { 'filter.names': name }
    });
    const vm = Array.isArray(res.data) ? res.data[0] : null;
    return vm?.vm || null;
  }

  private async getDatastoreIdByName(name: string): Promise<string | null> {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/datastore', {
      headers: this.headers
    });
    const datastore = (res.data || []).find((d: any) => d.name === name);
    return datastore?.datastore || null;
  }

  private async getResourcePoolIdByName(name: string): Promise<string | null> {
    if (!this.sessionId) await this.authenticate();
    const res = await this.client.get('/api/vcenter/resource-pool', {
      headers: this.headers
    });
    const pool = (res.data || []).find((p: any) => p.name === name);
    return pool?.resource_pool || null;
  }

  private async getPrimaryDiskInfo(vmId: string): Promise<{
    key: number;
    controllerKey: number;
    unitNumber: number;
    capacityKB: number;
  } | null> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>config.hardware.device</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.soapRequest(xml);
    const diskRegex = /<VirtualDisk[^>]*>([\s\S]*?)<\/VirtualDisk>/g;
    let match: RegExpExecArray | null;
    while ((match = diskRegex.exec(data)) !== null) {
      const block = match[1];
      const keyMatch = block.match(/<key>(-?\d+)<\/key>/);
      const controllerMatch = block.match(/<controllerKey>(-?\d+)<\/controllerKey>/);
      const unitMatch = block.match(/<unitNumber>(\d+)<\/unitNumber>/);
      const capacityMatch = block.match(/<capacityInKB>(\d+)<\/capacityInKB>/);
      if (keyMatch && controllerMatch && unitMatch && capacityMatch) {
        return {
          key: Number(keyMatch[1]),
          controllerKey: Number(controllerMatch[1]),
          unitNumber: Number(unitMatch[1]),
          capacityKB: Number(capacityMatch[1])
        };
      }
    }

    return null;
  }

  async cloneVM(config: {
    templateName: string;
    vmName: string;
    folderPath?: string;
    folderId?: string;
    datastoreName?: string;
    datastoreId?: string;
    resourcePoolName?: string;
    resourcePoolId?: string;
  }): Promise<{ taskId: string }> {
    const templateId = await this.getVmIdByName(config.templateName);
    if (!templateId) {
      throw new Error(`Template not found: ${config.templateName}`);
    }

    let folderId = config.folderId;
    if (!folderId) {
      const folderName = config.folderPath?.split('/').filter(Boolean).pop();
      if (folderName) {
        folderId = (await this.getFolderByName(folderName)) ?? undefined;
      }
    }
    if (!folderId) {
      throw new Error('Target folder not found');
    }

    let datastoreId = config.datastoreId;
    if (!datastoreId && config.datastoreName) {
      datastoreId = (await this.getDatastoreIdByName(config.datastoreName)) ?? undefined;
      if (!datastoreId) {
        throw new Error(`Datastore not found: ${config.datastoreName}`);
      }
    }

    let resourcePoolId = config.resourcePoolId;
    if (!resourcePoolId && config.resourcePoolName) {
      resourcePoolId = (await this.getResourcePoolIdByName(config.resourcePoolName)) ?? undefined;
      if (!resourcePoolId) {
        throw new Error(`Resource pool not found: ${config.resourcePoolName}`);
      }
    }

    const locationXml = [
      datastoreId ? `<urn:datastore type="Datastore">${datastoreId}</urn:datastore>` : '',
      resourcePoolId ? `<urn:pool type="ResourcePool">${resourcePoolId}</urn:pool>` : ''
    ].join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:CloneVM_Task>
      <urn:_this type="VirtualMachine">${templateId}</urn:_this>
      <urn:folder type="Folder">${folderId}</urn:folder>
      <urn:name>${config.vmName}</urn:name>
      <urn:spec>
        <urn:location>
          ${locationXml}
        </urn:location>
        <urn:powerOn>false</urn:powerOn>
        <urn:template>false</urn:template>
      </urn:spec>
    </urn:CloneVM_Task>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.withRetry(() => this.soapRequest(xml), 'CloneVM_Task');
    const taskId = this.extractTaskId(data);
    if (!taskId) {
      throw new Error('CloneVM_Task did not return task id');
    }
    return { taskId };
  }

  async reconfigureVM(
    vmId: string,
    config: {
      cpuCores?: number;
      memoryMB?: number;
      diskGB?: number;
    }
  ): Promise<string> {
    const deviceChange: string[] = [];
    if (typeof config.diskGB === 'number' && config.diskGB > 0) {
      const diskInfo = await this.getPrimaryDiskInfo(vmId);
      if (diskInfo) {
        const desiredKB = Math.round(config.diskGB * 1024 * 1024);
        if (desiredKB > diskInfo.capacityKB) {
          deviceChange.push(`
            <urn:deviceChange>
              <urn:operation>edit</urn:operation>
              <urn:device xsi:type="VirtualDisk">
                <urn:key>${diskInfo.key}</urn:key>
                <urn:controllerKey>${diskInfo.controllerKey}</urn:controllerKey>
                <urn:unitNumber>${diskInfo.unitNumber}</urn:unitNumber>
                <urn:capacityInKB>${desiredKB}</urn:capacityInKB>
              </urn:device>
            </urn:deviceChange>
          `);
        }
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>
    <urn:ReconfigVM_Task>
      <urn:_this type="VirtualMachine">${vmId}</urn:_this>
      <urn:spec>
        ${typeof config.cpuCores === 'number' ? `<urn:numCPUs>${config.cpuCores}</urn:numCPUs>` : ''}
        ${typeof config.memoryMB === 'number' ? `<urn:memoryMB>${config.memoryMB}</urn:memoryMB>` : ''}
        ${deviceChange.join('')}
      </urn:spec>
    </urn:ReconfigVM_Task>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.withRetry(() => this.soapRequest(xml), 'ReconfigVM_Task');
    const taskId = this.extractTaskId(data);
    if (!taskId) {
      throw new Error('ReconfigVM_Task did not return task id');
    }
    return taskId;
  }

  async configureNetwork(
    vmId: string,
    networkConfig: {
      ipAddress: string;
      gateway: string;
      subnetMask: string;
      dnsServers: string[];
      hostName?: string;
    }
  ): Promise<string> {
    const dnsXml = networkConfig.dnsServers
      .map((dns) => `<urn:dnsServerList>${dns}</urn:dnsServerList>`)
      .join('');
    const hostName = networkConfig.hostName || `vm-${vmId}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:CustomizeVM_Task>
      <urn:_this type="VirtualMachine">${vmId}</urn:_this>
      <urn:spec>
        <urn:globalIPSettings>
          ${dnsXml}
        </urn:globalIPSettings>
        <urn:nicSettingMap>
          <urn:adapter>
            <urn:ip>
              <urn:ipAddress>${networkConfig.ipAddress}</urn:ipAddress>
              <urn:subnetMask>${networkConfig.subnetMask}</urn:subnetMask>
            </urn:ip>
            <urn:gateway>${networkConfig.gateway}</urn:gateway>
            ${dnsXml}
          </urn:adapter>
        </urn:nicSettingMap>
        <urn:identity>
          <urn:linuxPrep>
            <urn:hostName>
              <urn:fixedName>${hostName}</urn:fixedName>
            </urn:hostName>
            <urn:domain>local</urn:domain>
          </urn:linuxPrep>
        </urn:identity>
      </urn:spec>
    </urn:CustomizeVM_Task>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.withRetry(() => this.soapRequest(xml), 'CustomizeVM_Task');
    const taskId = this.extractTaskId(data);
    if (!taskId) {
      throw new Error('CustomizeVM_Task did not return task id');
    }
    return taskId;
  }

  async attachGPUPassthrough(
    vmId: string,
    gpuConfig: {
      devices: Array<{
        deviceId: string;
        hostId?: string;
        deviceName?: string;
        vendorId?: string;
      }>;
    }
  ): Promise<string> {
    if (!gpuConfig.devices.length) {
      throw new Error('No GPU devices specified');
    }

    const deviceChangeXml = gpuConfig.devices.map((device) => {
      return `
        <urn:deviceChange>
          <urn:operation>add</urn:operation>
          <urn:device xsi:type="VirtualPCIPassthrough">
            <urn:key>-1</urn:key>
            <urn:backing xsi:type="VirtualPCIPassthroughDeviceBackingInfo">
              <urn:id>${device.deviceId}</urn:id>
              <urn:deviceId>${device.deviceId}</urn:deviceId>
              ${device.hostId ? `<urn:systemId>${device.hostId}</urn:systemId>` : ''}
              ${device.vendorId ? `<urn:vendorId>${device.vendorId}</urn:vendorId>` : ''}
              ${device.deviceName ? `<urn:deviceName>${device.deviceName}</urn:deviceName>` : ''}
            </urn:backing>
          </urn:device>
        </urn:deviceChange>
      `;
    }).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>
    <urn:ReconfigVM_Task>
      <urn:_this type="VirtualMachine">${vmId}</urn:_this>
      <urn:spec>
        ${deviceChangeXml}
      </urn:spec>
    </urn:ReconfigVM_Task>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.withRetry(() => this.soapRequest(xml), 'ReconfigVM_Task(attachGPU)');
    const taskId = this.extractTaskId(data);
    if (!taskId) {
      throw new Error('AttachGPUPassthrough did not return task id');
    }
    return taskId;
  }

  async getTaskStatus(taskId: string): Promise<{
    status: 'queued' | 'running' | 'success' | 'error';
    progress: number;
    errorMessage?: string;
    resultId?: string;
  }> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>Task</urn:type>
          <urn:pathSet>info.state</urn:pathSet>
          <urn:pathSet>info.progress</urn:pathSet>
          <urn:pathSet>info.error</urn:pathSet>
          <urn:pathSet>info.result</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="Task">${taskId}</urn:obj>
        </urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`;

    const data = await this.withRetry(() => this.soapRequest(xml), 'TaskStatus');
    return this.parseTaskStatus(data);
  }

  async waitForTask(taskId: string, timeoutMs = 10 * 60 * 1000): Promise<{
    status: 'success' | 'error';
    progress: number;
    errorMessage?: string;
    resultId?: string;
  }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getTaskStatus(taskId);
      if (status.status === 'success' || status.status === 'error') {
        return {
          ...status,
          status: status.status
        };
      }
      await this.sleep(3000);
    }
    throw new Error(`Task ${taskId} timed out`);
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
