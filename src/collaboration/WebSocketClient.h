#pragma once

#include <QObject>
#include <QUrl>
#include <QByteArray>
#include <memory>

class QWebSocket;

namespace ByteBridge {

/**
 * WebSocket client for connecting to the Yjs collaboration server.
 * Handles the connection lifecycle and message passing.
 */
class WebSocketClient : public QObject
{
    Q_OBJECT

public:
    explicit WebSocketClient(QObject *parent = nullptr);
    ~WebSocketClient();

    void connectToServer(const QString &url);
    void disconnect();
    
    bool isConnected() const;
    QString serverUrl() const { return m_serverUrl; }

public slots:
    void sendMessage(const QByteArray &data);
    void sendTextMessage(const QString &message);

signals:
    void connected();
    void disconnected();
    void messageReceived(const QByteArray &data);
    void textMessageReceived(const QString &message);
    void errorOccurred(const QString &error);

private slots:
    void onConnected();
    void onDisconnected();
    void onBinaryMessageReceived(const QByteArray &message);
    void onTextMessageReceived(const QString &message);
    void onError();

private:
    std::unique_ptr<QWebSocket> m_socket;
    QString m_serverUrl;
    bool m_isConnected;
};

} // namespace ByteBridge
