package donations

import (
	"context"
	"errors"
	"time"

	"github.com/lebedev-nikita/coldbrew/internal/donationalerts"
	"github.com/lebedev-nikita/coldbrew/internal/streamlabs"
)

type Source string

const (
	DonationAlertsSource Source = "donationalerts"
	DonateStreamSource   Source = "donate_stream"
	StreamlabsSource     Source = "streamlabs"
)

func (source Source) displayName() string {
	switch source {
	case DonationAlertsSource:
		return "DonationAlerts"
	case DonateStreamSource:
		return "donate.stream"
	case StreamlabsSource:
		return "Streamlabs"
	default:
		return string(source)
	}
}

func parseSource(value string) (Source, bool) {
	source := Source(value)
	switch source {
	case DonationAlertsSource, DonateStreamSource, StreamlabsSource:
		return source, true
	default:
		return "", false
	}
}

type Tokens struct {
	AccessToken  string
	RefreshToken string
}

type ProviderConnection struct {
	Tokens
	SourceUserID string
}

type Donation struct {
	SourceDonationID string
	Author           *string
	Message          *string
	Amount           string
	Currency         string
	SourceCreatedAt  string
	OccurredAt       time.Time
}

type DonationBatch struct {
	Donations  []Donation
	Checkpoint *string
}

type provider interface {
	Source() Source
	AuthorizationURL(redirectURI, state string) string
	IssueConnection(context.Context, string, string) (ProviderConnection, error)
	RefreshTokens(context.Context, string) (Tokens, error)
	GetDonations(context.Context, string, *string) (DonationBatch, error)
	Run(context.Context, string, *string, func(DonationBatch) error) error
	Unauthorized(error) bool
}

type DonationAlertsAdapter struct {
	client *donationalerts.Client
	source *donationalerts.Source
	config donationalerts.Config
}

func NewDonationAlertsAdapter(client *donationalerts.Client, source *donationalerts.Source, config donationalerts.Config) *DonationAlertsAdapter {
	return &DonationAlertsAdapter{client: client, source: source, config: config}
}

func (*DonationAlertsAdapter) Source() Source { return DonationAlertsSource }

func (adapter *DonationAlertsAdapter) AuthorizationURL(redirectURI, _ string) string {
	return donationalerts.AuthorizationURL(adapter.config.ClientID, redirectURI)
}

func (adapter *DonationAlertsAdapter) IssueConnection(ctx context.Context, authCode, redirectURI string) (ProviderConnection, error) {
	connection, err := adapter.client.IssueConnection(ctx, adapter.config, authCode, redirectURI)
	if err != nil {
		return ProviderConnection{}, err
	}
	return ProviderConnection{
		SourceUserID: connection.SourceUserID,
		Tokens: Tokens{
			AccessToken:  connection.AccessToken,
			RefreshToken: connection.RefreshToken,
		},
	}, nil
}

func (adapter *DonationAlertsAdapter) RefreshTokens(ctx context.Context, refreshToken string) (Tokens, error) {
	tokens, err := adapter.client.RefreshTokens(ctx, adapter.config, refreshToken)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken}, nil
}

func (adapter *DonationAlertsAdapter) GetDonations(ctx context.Context, accessToken string, _ *string) (DonationBatch, error) {
	donations, err := adapter.client.GetDonations(ctx, accessToken)
	if err != nil {
		return DonationBatch{}, err
	}
	return DonationBatch{Donations: donationAlertsDonations(donations)}, nil
}

func (adapter *DonationAlertsAdapter) Run(ctx context.Context, accessToken string, _ *string, emit func(DonationBatch) error) error {
	return adapter.source.Run(ctx, accessToken, func(donation donationalerts.Donation) error {
		return emit(DonationBatch{Donations: donationAlertsDonations([]donationalerts.Donation{donation})})
	})
}

func (*DonationAlertsAdapter) Unauthorized(err error) bool {
	var requestError *donationalerts.RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

func donationAlertsDonations(donations []donationalerts.Donation) []Donation {
	result := make([]Donation, len(donations))
	for index, donation := range donations {
		result[index] = Donation{
			SourceDonationID: donation.SourceDonationID,
			Author:           donation.Author,
			Message:          donation.Message,
			Amount:           donation.Amount,
			Currency:         donation.Currency,
			SourceCreatedAt:  donation.SourceCreatedAt,
			OccurredAt:       donation.OccurredAt,
		}
	}
	return result
}

type StreamlabsAdapter struct {
	client *streamlabs.Client
	source *streamlabs.Source
	config streamlabs.Config
}

func NewStreamlabsAdapter(client *streamlabs.Client, source *streamlabs.Source, config streamlabs.Config) *StreamlabsAdapter {
	return &StreamlabsAdapter{client: client, source: source, config: config}
}

func (*StreamlabsAdapter) Source() Source { return StreamlabsSource }

func (adapter *StreamlabsAdapter) AuthorizationURL(redirectURI, state string) string {
	return streamlabs.AuthorizationURL(adapter.config.ClientID, redirectURI, state)
}

func (adapter *StreamlabsAdapter) IssueConnection(ctx context.Context, authCode, redirectURI string) (ProviderConnection, error) {
	connection, err := adapter.client.IssueConnection(ctx, adapter.config, authCode, redirectURI)
	if err != nil {
		return ProviderConnection{}, err
	}
	return ProviderConnection{
		SourceUserID: connection.SourceUserID,
		Tokens: Tokens{
			AccessToken:  connection.AccessToken,
			RefreshToken: connection.RefreshToken,
		},
	}, nil
}

func (adapter *StreamlabsAdapter) RefreshTokens(ctx context.Context, refreshToken string) (Tokens, error) {
	tokens, err := adapter.client.RefreshTokens(ctx, adapter.config, refreshToken)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken}, nil
}

func (adapter *StreamlabsAdapter) GetDonations(ctx context.Context, accessToken string, checkpoint *string) (DonationBatch, error) {
	history, err := adapter.client.GetDonations(ctx, accessToken, checkpoint)
	if err != nil {
		return DonationBatch{}, err
	}
	return streamlabsBatch(history), nil
}

func (adapter *StreamlabsAdapter) Run(ctx context.Context, accessToken string, checkpoint *string, emit func(DonationBatch) error) error {
	listenerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	wakes := make(chan struct{}, 1)
	listenerDone := make(chan error, 1)
	go func() {
		listenerDone <- adapter.source.Run(listenerCtx, accessToken, func() error {
			select {
			case wakes <- struct{}{}:
			default:
			}
			return nil
		})
	}()

	currentCheckpoint := checkpoint
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-listenerDone:
			if err == nil && ctx.Err() == nil {
				return errors.New("Streamlabs listener stopped unexpectedly")
			}
			return err
		case <-wakes:
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil
			case err := <-listenerDone:
				timer.Stop()
				return err
			case <-timer.C:
			}
			for len(wakes) > 0 {
				<-wakes
			}
			history, err := adapter.client.GetDonations(ctx, accessToken, currentCheckpoint)
			if err != nil {
				return err
			}
			batch := streamlabsBatch(history)
			if err := emit(batch); err != nil {
				return err
			}
			currentCheckpoint = batch.Checkpoint
		}
	}
}

func (*StreamlabsAdapter) Unauthorized(err error) bool {
	var requestError *streamlabs.RequestError
	return errors.As(err, &requestError) && requestError.Unauthorized
}

func streamlabsBatch(history streamlabs.History) DonationBatch {
	donations := make([]Donation, len(history.Donations))
	for index, donation := range history.Donations {
		donations[index] = Donation{
			SourceDonationID: donation.SourceDonationID,
			Author:           donation.Author,
			Message:          donation.Message,
			Amount:           donation.Amount,
			Currency:         donation.Currency,
			SourceCreatedAt:  donation.SourceCreatedAt,
			OccurredAt:       donation.OccurredAt,
		}
	}
	return DonationBatch{Donations: donations, Checkpoint: history.Checkpoint}
}
