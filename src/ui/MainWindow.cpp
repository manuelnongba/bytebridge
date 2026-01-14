#include "MainWindow.h"
#include "NameDialog.h"
#include "../app/Application.h"
#include "../editor/CodeEditor.h"
#include "../collaboration/Presence.h"
#include "../utils/Clipboard.h"

#include <QMenuBar>
#include <QMenu>
#include <QAction>
#include <QToolBar>
#include <QStatusBar>
#include <QComboBox>
#include <QLabel>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QMessageBox>
#include <QCloseEvent>
#include <QTimer>
#include <QSettings>
#include <QDebug>

namespace ByteBridge {

MainWindow::MainWindow(Application *app, QWidget *parent)
    : QMainWindow(parent)
    , m_app(app)
    , m_editor(nullptr)
    , m_presence(nullptr)
    , m_languageSelector(nullptr)
    , m_statusLabel(nullptr)
    , m_remoteCursorLabel(nullptr)
    , m_connectionStatusLabel(nullptr)
{
    setupUi();
    setupMenuBar();
    setupToolBar();
    setupStatusBar();
    setupConnections();
    
    // Check for saved username and auto-join default room
    QSettings settings;
    QString savedUsername = settings.value("username").toString();
    
    if (!savedUsername.isEmpty()) {
        startEditing("default-room", savedUsername);
    } else {
        showNameDialog();
    }
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUi()
{
    setWindowTitle("ByteBridge");
    resize(1200, 800);
    setMinimumSize(800, 600);
    
    // Central widget
    QWidget *centralWidget = new QWidget(this);
    QVBoxLayout *layout = new QVBoxLayout(centralWidget);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);
    
    // Create code editor
    m_editor = new CodeEditor(this);
    layout->addWidget(m_editor);
    
    // Remote cursor label (floating)
    m_remoteCursorLabel = new QLabel(this);
    m_remoteCursorLabel->setObjectName("remoteCursorLabel");
    m_remoteCursorLabel->hide();
    
    setCentralWidget(centralWidget);
    
    // Create presence manager
    m_presence = new Presence(m_editor, this);
}

void MainWindow::setupMenuBar()
{
    QMenuBar *menuBar = this->menuBar();
    
    // File menu
    QMenu *fileMenu = menuBar->addMenu(tr("&File"));
    
    QAction *createRoomAction = fileMenu->addAction(tr("Create Room"));
    createRoomAction->setShortcut(QKeySequence("Ctrl+N"));
    connect(createRoomAction, &QAction::triggered, this, &MainWindow::onCreateRoom);
    
    QAction *joinRoomAction = fileMenu->addAction(tr("Join Room..."));
    connect(joinRoomAction, &QAction::triggered, this, &MainWindow::onJoinRoom);
    
    fileMenu->addSeparator();
    
    QAction *copyLinkAction = fileMenu->addAction(tr("Copy Invite Link"));
    copyLinkAction->setShortcut(QKeySequence("Ctrl+Shift+C"));
    connect(copyLinkAction, &QAction::triggered, this, &MainWindow::onCopyInviteLink);
    
    fileMenu->addSeparator();
    
    QAction *leaveRoomAction = fileMenu->addAction(tr("Leave Room"));
    connect(leaveRoomAction, &QAction::triggered, this, &MainWindow::onLeaveRoom);
    
    fileMenu->addSeparator();
    
    QAction *quitAction = fileMenu->addAction(tr("Quit"));
    quitAction->setShortcut(QKeySequence::Quit);
    connect(quitAction, &QAction::triggered, this, &QMainWindow::close);
    
    // Edit menu
    QMenu *editMenu = menuBar->addMenu(tr("&Edit"));
    
    QAction *undoAction = editMenu->addAction(tr("Undo"));
    undoAction->setShortcut(QKeySequence::Undo);
    connect(undoAction, &QAction::triggered, m_editor, &CodeEditor::undo);
    
    QAction *redoAction = editMenu->addAction(tr("Redo"));
    redoAction->setShortcut(QKeySequence::Redo);
    connect(redoAction, &QAction::triggered, m_editor, &CodeEditor::redo);
    
    editMenu->addSeparator();
    
    QAction *cutAction = editMenu->addAction(tr("Cut"));
    cutAction->setShortcut(QKeySequence::Cut);
    connect(cutAction, &QAction::triggered, m_editor, &CodeEditor::cut);
    
    QAction *copyAction = editMenu->addAction(tr("Copy"));
    copyAction->setShortcut(QKeySequence::Copy);
    connect(copyAction, &QAction::triggered, m_editor, &CodeEditor::copy);
    
    QAction *pasteAction = editMenu->addAction(tr("Paste"));
    pasteAction->setShortcut(QKeySequence::Paste);
    connect(pasteAction, &QAction::triggered, m_editor, &CodeEditor::paste);
    
    editMenu->addSeparator();
    
    QAction *selectAllAction = editMenu->addAction(tr("Select All"));
    selectAllAction->setShortcut(QKeySequence::SelectAll);
    connect(selectAllAction, &QAction::triggered, m_editor, &CodeEditor::selectAll);
    
    // View menu
    QMenu *viewMenu = menuBar->addMenu(tr("&View"));
    
    QAction *zoomInAction = viewMenu->addAction(tr("Zoom In"));
    zoomInAction->setShortcut(QKeySequence::ZoomIn);
    connect(zoomInAction, &QAction::triggered, m_editor, &CodeEditor::zoomIn);
    
    QAction *zoomOutAction = viewMenu->addAction(tr("Zoom Out"));
    zoomOutAction->setShortcut(QKeySequence::ZoomOut);
    connect(zoomOutAction, &QAction::triggered, m_editor, &CodeEditor::zoomOut);
    
    QAction *resetZoomAction = viewMenu->addAction(tr("Reset Zoom"));
    resetZoomAction->setShortcut(QKeySequence("Ctrl+0"));
    connect(resetZoomAction, &QAction::triggered, m_editor, &CodeEditor::resetZoom);
    
    // Help menu
    QMenu *helpMenu = menuBar->addMenu(tr("&Help"));
    
    QAction *aboutAction = helpMenu->addAction(tr("About ByteBridge"));
    connect(aboutAction, &QAction::triggered, this, [this]() {
        QMessageBox::about(this, tr("About ByteBridge"),
            tr("ByteBridge v1.0.0\n\n"
               "A collaborative code editor for real-time editing.\n\n"
               "Built with Qt and C++."));
    });
}

void MainWindow::setupToolBar()
{
    QToolBar *toolBar = addToolBar(tr("Main Toolbar"));
    toolBar->setMovable(false);
    
    // Language selector
    QLabel *langLabel = new QLabel(tr("Language: "), toolBar);
    toolBar->addWidget(langLabel);
    
    m_languageSelector = new QComboBox(toolBar);
    m_languageSelector->setMinimumWidth(150);
    populateLanguageSelector();
    connect(m_languageSelector, QOverload<int>::of(&QComboBox::currentIndexChanged),
            this, &MainWindow::onLanguageChanged);
    toolBar->addWidget(m_languageSelector);
    
    toolBar->addSeparator();
    
    // Spacer
    QWidget *spacer = new QWidget(toolBar);
    spacer->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Preferred);
    toolBar->addWidget(spacer);
    
    // Connection status
    m_connectionStatusLabel = new QLabel(tr("Disconnected"), toolBar);
    m_connectionStatusLabel->setStyleSheet("color: #ff6b6b; padding: 0 10px;");
    toolBar->addWidget(m_connectionStatusLabel);
}

void MainWindow::setupStatusBar()
{
    QStatusBar *status = statusBar();
    
    m_statusLabel = new QLabel(tr("Ready"), status);
    status->addWidget(m_statusLabel, 1);
    
    QLabel *roomLabel = new QLabel(tr("No room"), status);
    roomLabel->setObjectName("roomLabel");
    status->addPermanentWidget(roomLabel);
}

void MainWindow::setupConnections()
{
    // Application signals
    connect(m_app, &Application::roomJoined, this, &MainWindow::onRoomJoined);
    connect(m_app, &Application::connectionStatusChanged, 
            this, &MainWindow::onConnectionStatusChanged);
    connect(m_app, &Application::deepLinkReceived, 
            this, &MainWindow::onDeepLinkReceived);
    connect(m_app, &Application::roomCreated, this, [this](const QString &roomId, const QString &link) {
        Clipboard::copy(link);
        QMessageBox::information(this, tr("Room Created"),
            tr("Invite link copied to clipboard:\n%1").arg(link));
    });
    connect(m_app, &Application::errorOccurred, this, [this](const QString &error) {
        QMessageBox::warning(this, tr("Error"), error);
    });
    
    // Presence signals
    connect(m_presence, &Presence::remoteUserEditing, 
            this, &MainWindow::onRemoteUserEditing);
}

void MainWindow::populateLanguageSelector()
{
    // Add common languages
    QStringList languages = {
        "Plain Text", "JavaScript", "TypeScript", "Python", "C++", "C",
        "Java", "C#", "Go", "Rust", "Ruby", "PHP", "Swift", "Kotlin",
        "HTML", "CSS", "SCSS", "JSON", "XML", "YAML", "Markdown",
        "SQL", "Shell", "PowerShell"
    };
    
    m_languageSelector->addItems(languages);
    m_languageSelector->setCurrentText("JavaScript");
}

void MainWindow::showNameDialog(const QString &roomId)
{
    m_pendingRoomId = roomId.isEmpty() ? "default-room" : roomId;
    
    NameDialog dialog(this);
    
    // Load saved username
    QSettings settings;
    QString savedName = settings.value("username").toString();
    if (!savedName.isEmpty()) {
        dialog.setUsername(savedName);
    }
    
    if (dialog.exec() == QDialog::Accepted) {
        QString username = dialog.username();
        if (!username.isEmpty()) {
            settings.setValue("username", username);
            startEditing(m_pendingRoomId, username);
        }
    }
}

void MainWindow::startEditing(const QString &roomId, const QString &username)
{
    qDebug() << "Starting editing session - Room:" << roomId << "User:" << username;
    
    m_app->setUsername(username);
    m_app->joinRoom(roomId, username);
    
    // Update presence with user info
    m_presence->setLocalUser(username);
    
    // Update status
    m_statusLabel->setText(tr("Editing as %1").arg(username));
}

void MainWindow::onCreateRoom()
{
    QString roomId = m_app->createRoom();
    
    // If not in a room, join the new room
    if (m_app->currentRoomId().isEmpty()) {
        if (m_app->username().isEmpty()) {
            showNameDialog(roomId);
        } else {
            m_app->joinRoom(roomId, m_app->username());
        }
    }
}

void MainWindow::onJoinRoom()
{
    // For now, just show name dialog
    // In a full implementation, we'd have a dialog to enter room ID
    showNameDialog();
}

void MainWindow::onLeaveRoom()
{
    m_app->leaveRoom();
    m_statusLabel->setText(tr("Left room"));
    
    QLabel *roomLabel = statusBar()->findChild<QLabel*>("roomLabel");
    if (roomLabel) {
        roomLabel->setText(tr("No room"));
    }
}

void MainWindow::onCopyInviteLink()
{
    if (m_app->currentRoomId().isEmpty()) {
        QMessageBox::warning(this, tr("No Room"),
            tr("You need to be in a room to copy an invite link."));
        return;
    }
    
    QString link = QString("myapp://join?room=%1").arg(m_app->currentRoomId());
    Clipboard::copy(link);
    
    m_statusLabel->setText(tr("Invite link copied!"));
    QTimer::singleShot(3000, this, [this]() {
        m_statusLabel->setText(tr("Ready"));
    });
}

void MainWindow::onLanguageChanged(int index)
{
    QString language = m_languageSelector->currentText().toLower();
    m_editor->setLanguage(language);
}

void MainWindow::onConnectionStatusChanged(bool connected)
{
    if (connected) {
        m_connectionStatusLabel->setText(tr("Connected"));
        m_connectionStatusLabel->setStyleSheet("color: #69db7c; padding: 0 10px;");
    } else {
        m_connectionStatusLabel->setText(tr("Disconnected"));
        m_connectionStatusLabel->setStyleSheet("color: #ff6b6b; padding: 0 10px;");
    }
}

void MainWindow::onRoomJoined(const QString &roomId)
{
    QLabel *roomLabel = statusBar()->findChild<QLabel*>("roomLabel");
    if (roomLabel) {
        roomLabel->setText(tr("Room: %1").arg(roomId));
    }
}

void MainWindow::onDeepLinkReceived(const QString &roomId)
{
    qDebug() << "Deep link received for room:" << roomId;
    
    // Show dialog to get username, then join room
    showNameDialog(roomId);
}

void MainWindow::onRemoteUserEditing(const QString &userName)
{
    m_remoteCursorLabel->setText(userName + tr(" is editing..."));
    m_remoteCursorLabel->show();
    m_remoteCursorLabel->adjustSize();
    
    // Position in top-right corner
    m_remoteCursorLabel->move(width() - m_remoteCursorLabel->width() - 20, 80);
    
    // Hide after 1 second
    QTimer::singleShot(1000, m_remoteCursorLabel, &QLabel::hide);
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    m_app->leaveRoom();
    event->accept();
}

} // namespace ByteBridge
