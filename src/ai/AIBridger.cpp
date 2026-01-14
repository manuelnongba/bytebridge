#include "AIBridger.h"

#include <QtConcurrent>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QEventLoop>
#include <QDebug>

namespace ByteBridge {

AIBridger::AIBridger(QObject *parent)
    : QObject(parent)
    , m_endpoint("https://api.openai.com/v1/chat/completions")
    , m_model("gpt-4")
    , m_enabled(false)
{
}

QString AIBridger::getSuggestion(const QString &code)
{
    if (!m_enabled) {
        return QString("AI suggestions are disabled. Enable them in settings.");
    }
    
    if (m_apiKey.isEmpty()) {
        // Return placeholder suggestion (like original TS version)
        return QString("AI suggests improvement for: %1").arg(code.left(50));
    }
    
    // Make synchronous API call
    QNetworkAccessManager manager;
    QUrl url(m_endpoint);
    QNetworkRequest request{url};
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("Authorization", QString("Bearer %1").arg(m_apiKey).toUtf8());
    
    // Prepare request body
    QJsonObject body;
    body["model"] = m_model;
    
    QJsonArray messages;
    QJsonObject systemMsg;
    systemMsg["role"] = "system";
    systemMsg["content"] = "You are a helpful code assistant. Provide brief, actionable suggestions for improving the given code.";
    messages.append(systemMsg);
    
    QJsonObject userMsg;
    userMsg["role"] = "user";
    userMsg["content"] = QString("Please suggest improvements for this code:\n\n%1").arg(code);
    messages.append(userMsg);
    
    body["messages"] = messages;
    body["max_tokens"] = 500;
    body["temperature"] = 0.7;
    
    QJsonDocument doc(body);
    
    // Send request
    QNetworkReply *reply = manager.post(request, doc.toJson());
    
    // Wait for response
    QEventLoop loop;
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    loop.exec();
    
    if (reply->error() != QNetworkReply::NoError) {
        QString error = reply->errorString();
        qWarning() << "AI API error:" << error;
        emit errorOccurred(error);
        reply->deleteLater();
        return QString("Error getting AI suggestion: %1").arg(error);
    }
    
    // Parse response
    QByteArray responseData = reply->readAll();
    reply->deleteLater();
    
    QJsonDocument responseDoc = QJsonDocument::fromJson(responseData);
    if (responseDoc.isNull() || !responseDoc.isObject()) {
        return "Error parsing AI response";
    }
    
    QJsonObject response = responseDoc.object();
    QJsonArray choices = response["choices"].toArray();
    
    if (choices.isEmpty()) {
        return "No suggestions available";
    }
    
    QJsonObject firstChoice = choices[0].toObject();
    QJsonObject message = firstChoice["message"].toObject();
    QString suggestion = message["content"].toString();
    
    emit suggestionReady(suggestion);
    return suggestion;
}

QFuture<QString> AIBridger::getSuggestionAsync(const QString &code)
{
    return QtConcurrent::run([this, code]() {
        return getSuggestion(code);
    });
}

} // namespace ByteBridge
