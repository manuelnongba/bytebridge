/**
 * ByteBridge - A Collaborative Code Editor
 * 
 * Main entry point for the application.
 * 
 * Copyright (c) 2026 ByteBridge
 */

#include <QApplication>
#include <QFile>
#include <QDebug>

#include "app/Application.h"
#include "ui/MainWindow.h"
#include "utils/DeepLink.h"

int main(int argc, char *argv[])
{
    // Enable high DPI scaling
    QApplication::setHighDpiScaleFactorRoundingPolicy(
        Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);
    
    QApplication app(argc, argv);
    
    // Set application metadata
    QApplication::setApplicationName("ByteBridge");
    QApplication::setApplicationVersion("1.0.0");
    QApplication::setOrganizationName("ByteBridge");
    QApplication::setOrganizationDomain("bytebridge.io");
    
    // Load stylesheet
    QFile styleFile(":/styles/main.qss");
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        QString styleSheet = styleFile.readAll();
        app.setStyleSheet(styleSheet);
        styleFile.close();
    } else {
        qWarning() << "Could not load stylesheet";
    }
    
    // Initialize the application controller
    ByteBridge::Application appController;
    
    // Register custom URL protocol handler
    ByteBridge::DeepLink::registerProtocol("myapp");
    
    // Handle deep link from command line arguments
    for (int i = 1; i < argc; ++i) {
        QString arg = QString::fromUtf8(argv[i]);
        if (arg.startsWith("myapp://")) {
            appController.handleDeepLink(arg);
            break;
        }
    }
    
    // Create and show main window
    ByteBridge::MainWindow mainWindow(&appController);
    mainWindow.show();
    
    // Connect deep link handler
    QObject::connect(&ByteBridge::DeepLink::instance(), 
                     &ByteBridge::DeepLink::deepLinkReceived,
                     &appController, 
                     &ByteBridge::Application::handleDeepLink);
    
    return app.exec();
}
