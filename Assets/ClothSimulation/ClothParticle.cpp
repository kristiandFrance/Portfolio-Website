// Fill out your copyright notice in the Description page of Project Settings.


#include "ClothParticle.h"
#include "ClothConstraint.h"
#include "ClothSphere.h"

ClothParticle::ClothParticle(FVector _position)
{
    Position = _position;
	PreviousPosition = Position;
}

ClothParticle::~ClothParticle()
{
}

void ClothParticle::AddConstraint(ClothConstraint* _constraint)
{
    Constraints.Add(_constraint);
}

bool ClothParticle::SharesConstraint(ClothParticle* _otherParticle)
{
    for (auto iter : _otherParticle->GetConstraints())
    {
        if (Constraints.Contains(iter))
        {
            return true;
        }
    }
    return false;
}

bool ClothParticle::GetPinned()
{
    return IsPinned;
}

void ClothParticle::SetPinned(bool _isPinned)
{
	IsPinned = _isPinned;
}

TArray<class ClothConstraint*> ClothParticle::GetConstraints()
{
    return Constraints;
}

FVector ClothParticle::GetPosition()
{
    return Position;
}

void ClothParticle::SetPosition(FVector _position)
{
	Position = _position;
}

void ClothParticle::OffsetPosition(FVector _offset)
{
	Position += _offset;
}

void ClothParticle::AddForce(FVector _force)
{
    // Do Nothing If Particle Is Pinned
    if (GetPinned())
    {
        return;
    }
    
    Acceleration += _force;
}

void ClothParticle::Update(float _DeltaTime)
{
	Velocity = Position - PreviousPosition;

    if (BurnAmount > 0.0f)
    {
        float BurnDamage = BurnRate * _DeltaTime;
        AddBurn(BurnDamage);
        if (BurnAmount > 0.9f)
        {
            float ConstraintDamage = (BurnDamage + BurnAmount) * _DeltaTime;

            for (ClothConstraint* Constraint : Constraints)
            {
                Constraint->TakeDamage(ConstraintDamage);
            }
        }
    }
   


    FVector cachePosition = Position;

    if (GetPinned())
    {
        return;
    }

    if (PreviousDeltaTime <= 0.0f)
    {
        PreviousDeltaTime = _DeltaTime;
    }

    // Framerate independant verlet integration
    //Position +=   ((Position - PreviousPosition) * (1 - Damping) * (_DeltaTime / PreviousDeltaTime)) +
    //              (Acceleration * _DeltaTime * ((_DeltaTime + PreviousDeltaTime) * 0.5f));


    // Non-Framerate independant verlet integration
    Position += (Position - PreviousPosition) * (1.0f - Damping) +
        Acceleration * _DeltaTime;

    Acceleration = {0, 0, 0};

    PreviousPosition = cachePosition;
	PreviousDeltaTime = _DeltaTime;
}

void ClothParticle::CheckForGroundCollision(float _groundHeight)
{
	if (Position.Z <= _groundHeight)
	{
		Position.Z = _groundHeight;
        if (Acceleration.Z <= 0.0f)
        {
            Acceleration.Z = 0;
        }
        Damping = 0.1;
        OnGround = true;
	}
    else
    {
        OnGround = false;
    }
}

void ClothParticle::CheckForSphereCollision(AClothSphere* _clothSphere, FVector ClothPosition)
{
    float radius = _clothSphere->GetSphereRadius();
    FVector spherePosition = _clothSphere->GetActorLocation();
    FVector WorldPosition = Position + ClothPosition;

    float distance = FVector::Dist(WorldPosition, spherePosition);

    // Check if the particle is inside the sphere
    if (distance < radius)
    {
        // Calculate the direction vector pointing outward from the sphere center
        FVector direction = (WorldPosition - spherePosition);
        direction.Normalize();

        // Move the particle to the sphere's surface
        SetPosition( (direction * radius) + spherePosition - ClothPosition);
    }
}




void ClothParticle::AddBurn(float _burnAmount)
{
    BurnAmount = FMath::Clamp(BurnAmount + _burnAmount, 0.0f, 1.0f);
}

float ClothParticle::GetBurnAmount()
{
    return BurnAmount;
}

void ClothParticle::RemoveConstraint(ClothConstraint* _constraint)
{
    
    Constraints.Remove(_constraint);
}
