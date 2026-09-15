package restream

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"
)

var forbiddenPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func ValidateTargetURL(ctx context.Context, targetURL string) error {
	parsed, err := url.Parse(targetURL)
	if err != nil || (parsed.Scheme != "rtmp" && parsed.Scheme != "rtmps") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment == "" || strings.ContainsAny(parsed.Fragment, "# \t\r\n") {
		return errors.New("invalid restream target URL")
	}
	hostname := parsed.Hostname()
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", hostname)
	if err != nil {
		return fmt.Errorf("resolve restream target: %w", err)
	}
	if len(addresses) == 0 {
		return errors.New("restream target has no IP addresses")
	}
	for _, address := range addresses {
		address = address.Unmap()
		if !address.IsValid() || !address.IsGlobalUnicast() || isForbiddenAddress(address) {
			return errors.New("restream target resolves to a non-public address")
		}
	}
	return nil
}

func isForbiddenAddress(address netip.Addr) bool {
	for _, prefix := range forbiddenPrefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}
