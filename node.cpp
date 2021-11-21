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

#include <QGraphicsScene>
#include <QGraphicsSceneMouseEvent>
#include <QPainter>
#include <QStyleOption>
#include <QFont>

#include "node.h"
#include "graphwidget.h"
#include "layoutwidget.h"
#include <stdio.h>


Node::Node(QWidget *layoutWidget, double size1, double size2, char names_[256], int col, qreal x, qreal y )
    : layout(layoutWidget)
{
    width = size1;
    height = size2;
    color = col;
    xcoord = x;
    ycoord = y;
    sprintf( names, "%s", names_ );
    setFlag(ItemIsMovable);
    setFlag(ItemSendsGeometryChanges);
    setCacheMode(DeviceCoordinateCache);
    setZValue(-1);
}

Node::Node(GraphWidget *graphWidget, double size1, double size2, char names_[256], int col, qreal x, qreal y  )
    : graph(graphWidget)
{
    width = size1;
    height = size2;
    color = col;
    xcoord = x;
    ycoord = y;
    sprintf( names, "%s", names_ );
    setFlag(ItemIsMovable);
    setFlag(ItemSendsGeometryChanges);
    setCacheMode(DeviceCoordinateCache);
    setZValue(-1);
}

Node::Node(QWidget *w, double size1, double size2, char names_[256] )
    : w(w)
{
    width = size1;
    height = size2;
    sprintf( names, "%s", names_ );
    setFlag(ItemIsMovable);
    setFlag(ItemSendsGeometryChanges);
    setCacheMode(DeviceCoordinateCache);
    setZValue(-1);
}

//void Node::addEdge(Edge *edge)
//{
//    edgeList << edge;
//    edge->adjust();
//}
//
//QList<Edge *> Node::edges() const
//{
//    return edgeList;
//}


bool Node::advance()
{
    if (newPos == pos())
        return false;

    setPos(newPos);
    return true;
}

QRectF Node::boundingRect() const
{
    if( width*2 > 50 )
        return QRectF(-1*width, -1*height, width*2, height*2);
    else
        return QRectF(-1*width*20, -1*height*20, width*40, height*40);
}

QPainterPath Node::shape() const
{
    QPainterPath path;
    path.addEllipse(-1*width/2, -1*height/2, width, height);
    return path;
}

void Node::paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *)
{
    painter->setPen(Qt::NoPen);
    painter->setBrush(Qt::darkGray);
    QRectF rectangle(-1*width/2, -1*height/2, width, height);
    //painter->drawRect(-1*width/2, -1*height/2, width, height);
    QRadialGradient gradient(-4, -4, height);
    if (option->state & QStyle::State_Sunken) {
        gradient.setCenter(4, 4);
        gradient.setFocalPoint(3, 3);
        if( this->color == 1 )
            gradient.setColorAt(1, QColor(Qt::yellow).lighter(120));
        if( this->color == 2 )
            gradient.setColorAt(1, QColor(Qt::red).lighter(120));
        if( this->color == 3 )
            gradient.setColorAt(1, QColor(Qt::blue).lighter(120));
        if( this->color == 4 )
            gradient.setColorAt(1, QColor(Qt::green).lighter(120));
        if( this->color == 5 )
            gradient.setColorAt(1, QColor(Qt::gray).lighter(120));
        gradient.setColorAt(0, QColor(Qt::red).lighter(120));
    } else {
        if( this->color == 1 )
            gradient.setColorAt(0, Qt::yellow);
        else
            if( this->color == 2 )
                gradient.setColorAt(0, Qt::red);
            else
                if( this->color == 3 )
                    gradient.setColorAt(0, Qt::blue);
                else
                    if( this->color == 4 )
                        gradient.setColorAt(0, Qt::green);
                    else
                        if( this->color == 5 )
                            gradient.setColorAt(0, Qt::gray);
                        else
                            gradient.setColorAt(0, Qt::yellow);
        gradient.setColorAt(1, Qt::white);
    }
    painter->setBrush(gradient);
    painter->setPen(QPen(Qt::black, 0));
    //painter->drawRect(-1*width/2, -1*height/2, width, height);
    QString text(names),after;
    text = text.replace("_","\n");
    painter->drawRoundedRect( rectangle, 10.0, 10.0 );    
    if( this->width*2 > 50 ){
        QFont font("Helvetica",this->width/7,0,false);
        painter->setFont(font);
        painter->drawText( QRectF( -1*this->width, -1*this->height, this->width*2, this->height*2 ), Qt::AlignCenter , text);
    }
    else{
//        QRectF *rect = new QRectF( -1*this->width, -1*this->height, this->width*2, this->height*2 );
        QFont font("Times",this->width/7,0,false);
        painter->setFont(font);
        painter->drawText( QRectF( -1*this->width*20, -1*this->height*20, this->width*40, this->height*40 ), Qt::AlignCenter , text );
    }

}

QVariant Node::itemChange(GraphicsItemChange change, const QVariant &value)
{
/*
    if (change == ItemPositionChange && scene()) {
        // value is the new position.
        QPointF newPos = value.toPointF();
        QRectF rect = scene()->sceneRect();
        if (!rect.contains(newPos)) {
            // Keep the item inside the scene rect.
            newPos.setX(qMin(rect.right(), qMax(newPos.x(), rect.left())));
            newPos.setY(qMin(rect.bottom(), qMax(newPos.y(), rect.top())));
            return newPos;
        }
    }
*/
    return QGraphicsItem::itemChange(change, value);
}

bool Node::mouseDoubleClickEvent( QMouseEvent *event )
{
    clicked = true;
    return true;
}


//
//void Node::mouseReleaseEvent(QGraphicsSceneMouseEvent *event)
//{
//    update();
//    QGraphicsItem::mouseReleaseEvent(event);
//}
