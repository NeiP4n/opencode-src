export * as HubNetwork from "./network.js"

import type { Entry } from "../types.js"

// HTTP, DNS and socket diagnostics.
export const entries: Entry[] = [
  {
    id: "network.get",
    title: "HTTP GET",
    description: "Fetch a URL with headers and status line",
    category: "network",
    requires: ["curl"],
    templates: { bash: "curl -sS -i {url}" },
  },
  {
    id: "network.download",
    title: "Download a file",
    description: "Download a URL to a target path with progress",
    category: "network",
    requires: ["curl"],
    templates: { bash: "curl -sS -L -o {output} {url}" },
  },
  {
    id: "network.post-json",
    title: "POST JSON",
    description: "Send a JSON body to an endpoint",
    category: "network",
    requires: ["curl"],
    templates: { bash: "curl -sS -X POST -H 'Content-Type: application/json' -d {json} {url}" },
  },
  {
    id: "network.headers",
    title: "Response headers only",
    description: "Fetch just the headers of a URL",
    category: "network",
    requires: ["curl"],
    templates: { bash: "curl -sS -I {url}" },
  },
  {
    id: "network.dns",
    title: "Resolve DNS records",
    description: "Query DNS records of a host",
    category: "network",
    requires: ["dig"],
    templates: { bash: "dig +short {host} {type?}" },
  },
  {
    id: "network.ping",
    title: "Ping a host",
    description: "ICMP reachability and round-trip times",
    category: "network",
    requires: ["ping"],
    templates: { bash: "ping -c {count} {host}" },
  },
  {
    id: "network.sockets",
    title: "List open sockets",
    description: "TCP/UDP sockets with process attribution",
    category: "network",
    requires: ["ss"],
    templates: { bash: "ss -tulpn" },
  },
  {
    id: "network.public-ip",
    title: "Public IP address",
    description: "External IP as seen by the network",
    category: "network",
    requires: ["curl"],
    templates: { bash: "curl -sS https://api.ipify.org" },
  },
  {
    id: "network.ports-scan",
    title: "Check open ports of a host",
    description: "Probe common TCP ports on a target",
    category: "network",
    requires: ["nc"],
    templates: { bash: "nc -zv -w {timeout} {host} {port}" },
  },
  {
    id: "network.trace",
    title: "Route trace",
    description: "Hop-by-hop path to a host",
    category: "network",
    requires: ["traceroute"],
    templates: { bash: "traceroute {host}" },
  },
]
