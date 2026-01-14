#pragma once

#include <QMainWindow>
#include <QPointer>

class QLabel;
class QComboBox;
class QStatusBar;

namespace ByteBridge {

class Application;
class CodeEditor;
class NameDialog;
class Presence;

/**
 * Main application window containing the editor, toolbar, and status bar.
 * Equivalent to the BrowserWindow in the Electron version.
 */
class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(Application *app, QWidget *parent = nullptr);
    ~MainWindow();

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void onCreateRoom();
    void onJoinRoom();
    void onLeaveRoom();
    void onCopyInviteLink();
    void onLanguageChanged(int index);
    void onConnectionStatusChanged(bool connected);
    void onRoomJoined(const QString &roomId);
    void onDeepLinkReceived(const QString &roomId);
    void onRemoteUserEditing(const QString &userName);

private:
    void setupUi();
    void setupMenuBar();
    void setupToolBar();
    void setupStatusBar();
    void setupConnections();
    void showNameDialog(const QString &roomId = QString());
    void startEditing(const QString &roomId, const QString &username);
    void populateLanguageSelector();

    Application *m_app;
    CodeEditor *m_editor;
    Presence *m_presence;
    
    // UI Components
    QComboBox *m_languageSelector;
    QLabel *m_statusLabel;
    QLabel *m_remoteCursorLabel;
    QLabel *m_connectionStatusLabel;
    
    QString m_pendingRoomId;
};

} // namespace ByteBridge
