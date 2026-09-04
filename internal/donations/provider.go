package donations

import (
	"context"

	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
)

type DonationAlertsAdapter struct {
	client *donationalerts.Client
	source *donationalerts.Source
}

func NewDonationAlertsAdapter(client *donationalerts.Client, source *donationalerts.Source) *DonationAlertsAdapter {
	return &DonationAlertsAdapter{client: client, source: source}
}

func (adapter *DonationAlertsAdapter) IssueConnection(ctx context.Context, config donationalerts.Config, authCode, redirectURI string) (donationalerts.Connection, error) {
	return adapter.client.IssueConnection(ctx, config, authCode, redirectURI)
}

func (adapter *DonationAlertsAdapter) RefreshTokens(ctx context.Context, config donationalerts.Config, refreshToken string) (donationalerts.Tokens, error) {
	return adapter.client.RefreshTokens(ctx, config, refreshToken)
}

func (adapter *DonationAlertsAdapter) GetDonations(ctx context.Context, accessToken string) ([]donationalerts.Donation, error) {
	return adapter.client.GetDonations(ctx, accessToken)
}

func (adapter *DonationAlertsAdapter) Run(ctx context.Context, accessToken string, emit func(donationalerts.Donation) error) error {
	return adapter.source.Run(ctx, accessToken, emit)
}

var _ donationAlerts = (*DonationAlertsAdapter)(nil)
