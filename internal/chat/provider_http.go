package chat

import (
	"errors"
	"fmt"
)

type ProviderHTTPError struct{ Status int }

func (e *ProviderHTTPError) Error() string { return fmt.Sprintf("provider HTTP %d", e.Status) }

func operationError(detail string, cause error) error {
	var httpError *ProviderHTTPError
	if errors.As(cause, &httpError) {
		if httpError.Status == 401 {
			return &ProviderError{Type: "provider unauthorized", Detail: detail, Cause: cause}
		}
		if httpError.Status == 429 {
			return &ProviderError{Type: "provider rate limited", Detail: detail, Cause: cause}
		}
	}
	return &ProviderError{Type: "provider unavailable", Detail: detail, Cause: cause}
}
