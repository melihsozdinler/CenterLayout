//************************************************************************************
/**	Copyright (C) <2010>  <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
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
**     Copyright (C)<2010>
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

#include "subgraphwidget.h"
#include "node.h"
#include "mainwindow.h"

#include <QDebug>
#include <QGraphicsScene>
#include <QWheelEvent>
//#include <QPrinter>
#include <QPainter>

#include <QMainWindow>
#include <QWidget>
//#include <QtWebKit/QWebView>
#include <QGraphicsWidget>

#include <math.h>
using namespace std;

SubGraphWidget::SubGraphWidget()
    : timerId(0)
{

    QGraphicsScene *scene = new QGraphicsScene();
    scene->setItemIndexMethod(QGraphicsScene::NoIndex);
    setScene(scene);
    setCacheMode(CacheBackground);
    setViewportUpdateMode(BoundingRectViewportUpdate);
    setRenderHint(QPainter::Antialiasing);
    setTransformationAnchor(AnchorUnderMouse);
    setResizeAnchor(AnchorViewCenter);

    FILE *fptr = fopen( "temp.txt", "r");
    int count = 0;
    char labelName[256],labelName2[256];
    double number;
    fscanf( fptr, "%lf", &number );
    fscanf( fptr, "%lf", &number );
    fscanf( fptr, "%d%s", &count, labelName2 );
    Node *node1;

    QLineF linei( 0.0, 0.0, 50.0, 50.0 );
    QLineF line2( 0.0, 0.0, count * 5 + 20, count * 5 + 20 );
    QLineF line( 0, 0, count * 5, count * 5 );

    if( count * 5.0 < 100.0 ){
        QLineF line2_( 0.0, 0.0, 100.0 + 20.0, 100.0 + 20.0 );
        QLineF line_( 0, 0, 100.0, 100.0 );
        line2 = line2_;
        line = line_;
    }
    //scene->setSceneRect( -1.0*line2.length()-50.0, -1.0*line2.length()-50.0, line2.length()*2+100.0, line2.length()*2+100.0 );

    qreal allangle = 360.0;
    qreal angle = allangle / count;
    count = 0;
    while( !feof( fptr ) ){
        if( count == number )
            break;
        fscanf( fptr, "%s", labelName );
        QPen qpen;
        linei.setAngle( allangle );
        line.setAngle( allangle );
        line2.setAngle( allangle );

        scene->addLine( linei.x2(),linei.y2(),line.x2(),line.y2(), qpen );
        node1 = new Node(this,(45.0),(45.0), labelName );

        scene->addItem(node1);
        node1->setPos(line2.x2(),line2.y2());
        node1->setToolTip(labelName);
        node1->opacity();
        allangle -= angle;
        count++;
    }

    node1 = new Node(this,(90.0),(90.0), labelName2 );
    scene->addItem(node1);
    node1->setPos(0.0,0.0);
    node1->setToolTip(labelName2);
    node1->opacity();

    fclose( fptr );
    scale(qreal(0.8), qreal(0.8));
    setMinimumSize(200, 200);
    //QPrinter *printer = new QPrinter();
    //printer->setPageSize( QPrinter::A2 );
    //printer->setOutputFormat(QPrinter::OutputFormat());
    //

    //printer->setOutputFileName("outputs\\sub.pdf");
    //QPainter *pdfPainter = new QPainter(printer);
    //scene->render(pdfPainter);
    //pdfPainter->end();
}
void SubGraphWidget::mouseDoubleClickEvent( QMouseEvent *event ){
    if (event->button() == Qt::LeftButton){
        this->close();
    }
}

void SubGraphWidget::itemMoved()
{
    if (!timerId)
        timerId = startTimer(1000 / 25);
}


void SubGraphWidget::wheelEvent(QWheelEvent *event)
{
    scaleView(pow((double)2, event->angleDelta().x() / 240.0));
}

//void SubGraphWidget::drawBackground(QPainter *painter, const QRectF &rect)
//{
//    Q_UNUSED(rect);
//
//    // Shadow
//    QRectF sceneRect = this->sceneRect();
//    QRectF rightShadow(sceneRect.right(), sceneRect.top() + 5, 5, sceneRect.height());
//    QRectF bottomShadow(sceneRect.left() + 5, sceneRect.bottom(), sceneRect.width(), 5);
//    if (rightShadow.intersects(rect) || rightShadow.contains(rect))
//	painter->fillRect(rightShadow, Qt::darkGray);
//    if (bottomShadow.intersects(rect) || bottomShadow.contains(rect))
//	painter->fillRect(bottomShadow, Qt::darkGray);
//
//    // Fill
//    QLinearGradient gradient(sceneRect.topLeft(), sceneRect.bottomRight());
//    gradient.setColorAt(0, Qt::white);
//    gradient.setColorAt(1, Qt::lightGray);
//    painter->fillRect(rect.intersect(sceneRect), gradient);
//    painter->setBrush(Qt::NoBrush);
//    painter->drawRect(sceneRect);
//
//    // Text
//    QRectF textRect(sceneRect.left() + 4, sceneRect.top() + 4,
//                    sceneRect.width() - 4, sceneRect.height() - 4);
//    QString message(tr(""));
//
//    QFont font = painter->font();
//    font.setBold(true);
//    font.setPointSize(14);
//    painter->setFont(font);
//    painter->setPen(Qt::lightGray);
//    painter->drawText(textRect.translated(2, 2), message);
//    painter->setPen(Qt::black);
//    painter->drawText(textRect, message);
//}

void SubGraphWidget::scaleView(qreal scaleFactor)
{
    scale(scaleFactor, scaleFactor);
}
