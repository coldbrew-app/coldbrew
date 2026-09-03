package chat

import (
	"context"
	"crypto/tls"
	"errors"

	"github.com/lebedev-nikita/coldbrew/internal/youtubechatpb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type youtubeLiveChatCursor struct {
	LiveChatID string
	PageToken  string
}

type youtubeLiveChatSession interface {
	Recv() (*youtubechatpb.LiveChatMessageListResponse, error)
	Close() error
}

type youtubeLiveChatOpen func(context.Context, youtubeLiveChatCursor, string) (youtubeLiveChatSession, error)

type grpcYoutubeLiveChatSession struct {
	stream youtubechatpb.V3DataLiveChatMessageService_StreamListClient
	conn   *grpc.ClientConn
}

func (session *grpcYoutubeLiveChatSession) Recv() (*youtubechatpb.LiveChatMessageListResponse, error) {
	return session.stream.Recv()
}

func (session *grpcYoutubeLiveChatSession) Close() error {
	return session.conn.Close()
}

func openYoutubeLiveChat(ctx context.Context, cursor youtubeLiveChatCursor, accessToken string) (youtubeLiveChatSession, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: "youtube.googleapis.com"}
	connection, err := grpc.NewClient("youtube.googleapis.com:443", grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
	if err != nil {
		return nil, err
	}
	request := youtubeLiveChatRequest(cursor)
	authorized := youtubeLiveChatContext(ctx, accessToken)
	stream, err := youtubechatpb.NewV3DataLiveChatMessageServiceClient(connection).StreamList(authorized, request)
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return &grpcYoutubeLiveChatSession{stream: stream, conn: connection}, nil
}

func youtubeLiveChatRequest(cursor youtubeLiveChatCursor) *youtubechatpb.LiveChatMessageListRequest {
	request := &youtubechatpb.LiveChatMessageListRequest{
		LiveChatId: proto.String(cursor.LiveChatID),
		Part:       []string{"snippet", "authorDetails"},
	}
	if cursor.PageToken != "" {
		request.PageToken = proto.String(cursor.PageToken)
	}
	return request
}

func youtubeLiveChatContext(ctx context.Context, accessToken string) context.Context {
	return metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+accessToken)
}

func (provider *YoutubeProvider) handleYoutubeLiveChatError(ctx context.Context, source ConnectedSource, events chan<- StreamEvent, errorsChannel chan<- error, cause error) bool {
	if ctx.Err() != nil || errors.Is(cause, context.Canceled) || status.Code(cause) == codes.Canceled {
		return false
	}
	var errorType string
	switch status.Code(cause) {
	case codes.PermissionDenied, codes.Unauthenticated:
		errorType = "provider unauthorized"
	case codes.ResourceExhausted:
		errorType = "provider rate limited"
	case codes.FailedPrecondition, codes.NotFound:
		sendStreamEvent(ctx, events, StreamEvent{Type: "state", SourceID: source.Source.SourceID, State: "offline"})
		<-ctx.Done()
		return false
	case codes.InvalidArgument:
		errorType = "provider rejected command"
	default:
		errorType = "provider unavailable"
	}
	sendProviderError(ctx, errorsChannel, &ProviderError{Type: errorType, Detail: "YouTube chat connection failed", Cause: cause})
	if errorType == "provider unauthorized" || errorType == "provider rejected command" {
		<-ctx.Done()
		return false
	}
	return true
}
