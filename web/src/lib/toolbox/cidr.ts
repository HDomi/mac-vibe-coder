/** IPv4 subnet math for the Network tool. */

export function ipToInt(ip: string): number {
  const parts = ip.trim().split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error(`Not an IPv4 address: ${ip}`);
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
}

function maskToPrefix(mask: string): number {
  const n = ipToInt(mask);
  const bits = n.toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bits)) throw new Error(`Not a contiguous netmask: ${mask}`);
  return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
}

export interface Subnet {
  ip: string; prefix: number; network: string; broadcast: string; mask: string; wildcard: string;
  first: string; last: string; hosts: number; total: number; kind: string;
}

/** Accepts `10.0.0.7/20`, `10.0.0.7 255.255.240.0`, or a bare address (taken as /32). */
export function parseSubnet(input: string): Subnet {
  const s = input.trim();
  let ip: string, prefix: number;
  const slash = /^([\d.]+)\s*\/\s*(\d{1,2})$/.exec(s);
  const spaced = /^([\d.]+)\s+([\d.]+)$/.exec(s);
  if (slash) { ip = slash[1]; prefix = Number(slash[2]); }
  else if (spaced) { ip = spaced[1]; prefix = maskToPrefix(spaced[2]); }
  else { ip = s; prefix = 32; }
  if (prefix > 32) throw new Error('Prefix must be 0-32');
  const addr = ipToInt(ip);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(addr / size) * size;
  const broadcast = network + size - 1;
  const maskInt = 2 ** 32 - size;
  const hostsFirst = prefix >= 31 ? network : network + 1;
  const hostsLast = prefix >= 31 ? broadcast : broadcast - 1;
  return {
    ip: intToIp(addr), prefix, network: intToIp(network), broadcast: intToIp(broadcast), mask: intToIp(maskInt), wildcard: intToIp(size - 1),
    first: intToIp(hostsFirst), last: intToIp(hostsLast), hosts: prefix === 32 ? 1 : prefix === 31 ? 2 : size - 2, total: size, kind: addressKind(addr),
  };
}

export function contains(subnet: Subnet, ip: string): boolean {
  const n = ipToInt(ip);
  return n >= ipToInt(subnet.network) && n <= ipToInt(subnet.broadcast);
}

/** Which well-known range an address falls in; i18n key suffix. */
export function addressKind(n: number): string {
  const inRange = (cidr: string) => { const [a, p] = cidr.split('/'); const size = 2 ** (32 - Number(p)); const base = ipToInt(a); return n >= base && n < base + size; };
  if (inRange('127.0.0.0/8')) return 'loopback';
  if (inRange('10.0.0.0/8') || inRange('172.16.0.0/12') || inRange('192.168.0.0/16')) return 'private';
  if (inRange('100.64.0.0/10')) return 'cgnat';
  if (inRange('169.254.0.0/16')) return 'linkLocal';
  if (inRange('224.0.0.0/4')) return 'multicast';
  if (inRange('0.0.0.0/8') || inRange('240.0.0.0/4')) return 'reserved';
  return 'public';
}
