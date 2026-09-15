package restream

import (
	"context"
	"testing"
)

func TestValidateTargetURLAcceptsPublicAddress(t *testing.T) {
	if err := ValidateTargetURL(context.Background(), "rtmps://8.8.8.8/live#stream-key"); err != nil {
		t.Fatalf("ValidateTargetURL() error = %v", err)
	}
}

func TestValidateTargetURLRejectsPrivateAndMalformedTargets(t *testing.T) {
	for _, target := range []string{
		"rtmp://127.0.0.1/live#stream-key",
		"rtmp://10.0.0.1/live#stream-key",
		"rtmp://100.64.0.1/live#stream-key",
		"rtmp://[::1]/live#stream-key",
		"https://8.8.8.8/live#stream-key",
		"rtmp://user:password@8.8.8.8/live#stream-key",
		"rtmp://8.8.8.8/live?secret=query#stream-key",
		"rtmp://8.8.8.8/live",
	} {
		t.Run(target, func(t *testing.T) {
			if err := ValidateTargetURL(context.Background(), target); err == nil {
				t.Fatal("ValidateTargetURL() unexpectedly succeeded")
			}
		})
	}
}
