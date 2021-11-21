//************************************************************************************
/**	Copyright (C) <2013>  <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**
**    This program is free software: you can redistribute it and/or modify
**    it under the terms of the GNU General Public License as published by
**    the Free Software Foundation, either version 3 of the License, or
**    (at your option) any later version.
**
**    This program is distributed in the hope that it will be useful,
**    but WITHOUT ANY WARRANTY; without even the implied warranty of
**    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
**    GNU General Public License for more details.
**
**    You should have received a copy of the GNU General Public License
**    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**
**    This .cpp file is created and implemented by
**     <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**     Copyright (C)<2013>
**    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
**    This is free software, and you are welcome to redistribute it
**    under certain conditions; type `show c' for details.
************************************************************************************/
/**
 ** Copyright (C) 2004-2007 Trolltech ASA. All rights reserved.
 **
 ** This file is part of the example classes of the Qt Toolkit.
 **
 ** This file may be used under the terms of the GNU General Public
 ** License version 2.0 as published by the Free Software Foundation
 ** and appearing in the file LICENSE.GPL included in the packaging of
 ** this file.  Please review the following information to ensure GNU
 ** General Public Licensing requirements will be met:
 ** http://www.trolltech.com/products/qt/opensource.html
 **
 ** If you are unsure which license is appropriate for your use, please
 ** review the following information:
 ** http://www.trolltech.com/products/qt/licensing.html or contact the
 ** sales department at sales@trolltech.com.
 **
 ** This file is provided AS IS with NO WARRANTY OF ANY KIND, INCLUDING THE
 ** WARRANTY OF DESIGN, MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
 **
 ************************************************************************************/

#include <QtGui>
#include <QtNetwork>
//#include <QtWebKit/QWebView>

#include "httpwindow.h"
#include "ui_authenticationdialog.h"

QString styleRed2("background-color: white;"
             "border-style: outset;"
             "border-width: 2px;"
             "border-radius: 10px;"
             "border-color: red;"
             "font: bold 10px;"
             "min-width: 10em;"
             "padding: 6px;");


HttpWindow::HttpWindow(QString qurl, QWidget *parent )
    : QDialog(parent)
{


    urlLineEdit = new QLineEdit( qurl );
    qurlMain = urlLineEdit->text();
//    QWebView *webView;
//
//    if (reply->error()) {
//        if( qurlMain.contains( "Saccharomyces_cerevisiae/") ){
//            qurlMain.replace( "Saccharomyces_cerevisiae/", "Saccharomyces_cerevisiae2/" );
//            urlLineEdit = new QLineEdit( qurlMain );
//            QUrl url2(urlLineEdit->text());
//            url = url2;
//        }
//    }
    urlLabel = new QLabel(tr("&URL:"));
    urlLabel->setBuddy(urlLineEdit);
    //urlLabel->setStyleSheet(styleRed);
    statusLabel = new QLabel(tr("Please click download to get source file"));
    //statusLabel->setStyleSheet(styleRed);
    downloadButton = new QPushButton(tr("Download"));
    downloadButton->setStyleSheet(styleRed2);
    downloadButton->setDefault(true);
    quitButton = new QPushButton(tr("Quit"));
    quitButton->setStyleSheet(styleRed2);
    quitButton->setAutoDefault(false);

    buttonBox = new QDialogButtonBox;
    buttonBox->addButton(downloadButton, QDialogButtonBox::ActionRole);
    buttonBox->addButton(quitButton, QDialogButtonBox::RejectRole);

    progressDialog = new QProgressDialog(this);

    http = new QHttp(this);

    connect(urlLineEdit, SIGNAL(textChanged(QString)),
            this, SLOT(enableDownloadButton()));
    connect(http, SIGNAL(requestFinished(int,bool)),
            this, SLOT(httpRequestFinished(int,bool)));
    connect(http, SIGNAL(dataReadProgress(int,int)),
            this, SLOT(updateDataReadProgress(int,int)));
    connect(http, SIGNAL(responseHeaderReceived(QHttpResponseHeader)),
            this, SLOT(readResponseHeader(QHttpResponseHeader)));
    connect(http, SIGNAL(authenticationRequired(QString,quint16,QAuthenticator*)),
            this, SLOT(slotAuthenticationRequired(QString,quint16,QAuthenticator*)));
#ifndef QT_NO_OPENSSL
    connect(http, SIGNAL(sslErrors(QList<QSslError>)),
            this, SLOT(sslErrors(QList<QSslError>)));
#endif
    connect(progressDialog, SIGNAL(canceled()), this, SLOT(cancelDownload()));
    connect(downloadButton, SIGNAL(clicked()), this, SLOT(downloadFile()));
    connect(quitButton, SIGNAL(clicked()), this, SLOT(close()));

    QHBoxLayout *topLayout = new QHBoxLayout;
    topLayout->addWidget(urlLabel);
    topLayout->addWidget(urlLineEdit);

    QVBoxLayout *mainLayout = new QVBoxLayout;
    mainLayout->addLayout(topLayout);
    mainLayout->addWidget(statusLabel);
    mainLayout->addWidget(buttonBox);
    setLayout(mainLayout);
    setWindowTitle(tr("HTTP"));
    urlLineEdit->setFocus();
}

void HttpWindow::downloadFile()
{
    QUrl url(urlLineEdit->text());

    QFileInfo fileInfo(url.path());
    QString fileName = fileInfo.fileName();
    if (fileName.isEmpty())
        fileName = "index.html";

    if (QFile::exists(fileName)) {
        if (QMessageBox::question(this, tr("HTTP"), 
                                  tr("There already exists a file called %1 in "
                                     "the current directory. Overwrite?").arg(fileName),
                                  QMessageBox::Yes|QMessageBox::No, QMessageBox::No)
            == QMessageBox::No)
            return;
        QFile::remove(fileName);
    }
    QString fileT = QString("outputs/");
    fileT.append(this->version);
    fileT.append("/graphs/");
    fileT.append(fileName);
    file = new QFile(fileT);
    if (!file->open(QIODevice::WriteOnly)) {
        QMessageBox::information(this, tr("HTTP"),
                                 tr("Unable to save the file %1: %2.")
                                 .arg(fileName).arg(file->errorString()));
        delete file;
        file = 0;
        return;
    }

    QHttp::ConnectionMode mode = url.scheme().toLower() == "https" ? QHttp::ConnectionModeHttps : QHttp::ConnectionModeHttp;
    http->setHost(url.host(), mode, url.port() == -1 ? 0 : url.port());
    
    if (!url.userName().isEmpty())
        http->setUser(url.userName(), url.password());

    httpRequestAborted = false;
    QByteArray path = QUrl::toPercentEncoding(url.path(), "!$&'()*+,;=:@/");
    if (path.isEmpty())
        path = "/";
    httpGetId = http->get(path, file);

    progressDialog->setWindowTitle(tr("HTTP"));
    progressDialog->setLabelText(tr("Downloading %1.").arg(fileName));
    downloadButton->setVisible(false);
    quitButton->setVisible(false);

}

void HttpWindow::cancelDownload()
{
    statusLabel->setText(tr("Download canceled."));
    httpRequestAborted = true;
    http->abort();
    downloadButton->setEnabled(true);
}

void HttpWindow::httpRequestFinished(int requestId, bool error)
{
    if (requestId != httpGetId)
        return;
    if (httpRequestAborted) {
        if (file) {
            file->close();
            file->remove();
            delete file;
            file = 0;
        }

        progressDialog->hide();
        return;
    }

    if (requestId != httpGetId)
        return;

    progressDialog->hide();
    file->close();
    if (error) {
        file->remove();
        QMessageBox::information(this, tr("HTTP"),
                                 tr("Download failed: %1.")
                                 .arg(http->errorString()));
    } else {
        QString fileName = QFileInfo(QUrl(urlLineEdit->text()).path()).fileName();
        statusLabel->setText(tr("Downloaded %1 to current directory.").arg(fileName));
    }

    downloadButton->setEnabled(false);
    delete file;
    file = 0;
}

void HttpWindow::readResponseHeader(const QHttpResponseHeader &responseHeader)
{
    switch (responseHeader.statusCode()) {
    case 200:                   // Ok
    case 301:                   // Moved Permanently
    case 302:                   // Found
    case 303:                   // See Other
    case 307:                   // Temporary Redirect
        // these are not error conditions
        break;

    default:
        QMessageBox::information(this, tr("HTTP"),
                                 tr("Download failed: %1.")
                                 .arg(responseHeader.reasonPhrase()));
        httpRequestAborted = true;
        progressDialog->hide();
        http->abort();
    }
}

void HttpWindow::updateDataReadProgress(int bytesRead, int totalBytes)
{
    if (httpRequestAborted)
        return;

    progressDialog->setMaximum(totalBytes);
    progressDialog->setValue(bytesRead);
}

void HttpWindow::enableDownloadButton()
{
    downloadButton->setEnabled(!urlLineEdit->text().isEmpty());
}

void HttpWindow::slotAuthenticationRequired(const QString &hostName, quint16, QAuthenticator *authenticator)
{
    QDialog dlg;
    Ui::Dialog ui;
    ui.setupUi(&dlg);
    dlg.adjustSize();
    ui.siteDescription->setText(tr("%1 at %2").arg(authenticator->realm()).arg(hostName));
    
    if (dlg.exec() == QDialog::Accepted) {
        authenticator->setUser(ui.userEdit->text());
        authenticator->setPassword(ui.passwordEdit->text());
    }
}

#ifndef QT_NO_OPENSSL
void HttpWindow::sslErrors(const QList<QSslError> &errors)
{
    QString errorString;
    foreach (const QSslError &error, errors) {
        if (!errorString.isEmpty())
            errorString += ", ";
        errorString += error.errorString();
    }

    QMessageBox msgBox;
    msgBox.setText("HTTP Example.");
    msgBox.setInformativeText(tr("One or more SSL errors has occurred: %1").arg(errorString));
    msgBox.setStandardButtons(QMessageBox::Ignore | QMessageBox::Abort);
    msgBox.setDefaultButton(QMessageBox::Ignore);
    int ret = msgBox.exec();
    
    if (ret == QMessageBox::Ignore) {
        http->ignoreSslErrors();
    }
}
#endif
