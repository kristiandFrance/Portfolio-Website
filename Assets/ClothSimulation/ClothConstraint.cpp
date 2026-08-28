// Fill out your copyright notice in the Description page of Project Settings.


#include "ClothConstraint.h"
#include "ClothParticle.h"


ClothConstraint::ClothConstraint(ClothParticle* _particleA, ClothParticle* _particleB)
{
    ParticleA = _particleA;
    ParticleB = _particleB;

	RestDistance = FVector::Dist(ParticleB->GetPosition(), ParticleA->GetPosition());
}



ClothConstraint::~ClothConstraint()
{
}

void ClothConstraint::Update(float _DeltaTime)
{
    if (!IsEnabled)
    {
        return;
    }

    if (ParticleA->GetPinned() && ParticleB->GetPinned())
    {
        return;
    }

    // Calculate the current offset and strain
    FVector CurrentOffset = ParticleB->GetPosition() - ParticleA->GetPosition();
    float CurrentDistance = CurrentOffset.Size();
    float Strain = (CurrentDistance - RestDistance) / RestDistance;

    // Check if strain exceeds the maximum allowed
    if (Strain > MaxStrain)
    {
        float ExcessStrain = Strain - MaxStrain;
        Health -= ExcessStrain * DamageScale * _DeltaTime;
    }
    // Disable constraint if health is depleted
    if (Health <= 0.0f)
    {
        DisableConstraint();
        return;
    }

    // Apply correction for the constraint
    FVector Correction = CurrentOffset * (1.0f - RestDistance / CurrentDistance);
    FVector HalfCorrection = Correction * 0.5f;

    if (!ParticleA->GetPinned() && !ParticleB->GetPinned())
    {
        ParticleA->OffsetPosition(HalfCorrection);
        ParticleB->OffsetPosition(-HalfCorrection);
    }
    else if (!ParticleA->GetPinned())
    {
        ParticleA->OffsetPosition(Correction);
    }
    else if (!ParticleB->GetPinned())
    {
        ParticleB->OffsetPosition(-Correction);
    }
	
	
	return; // Skips code ahead
	// IF WANTING TO DO WITH FORCE INSTEAD

	//float length = (float)CurrentOffset.Size();
	//float stiffness = 800.0f;
	//float deform = length - RestDistance;
	//FVector normOffset = CurrentOffset;
	//normOffset.Normalize();
	//
	//FVector force = normOffset * stiffness * deform;
	//FVector halfForce = force * 0.5f;
	//
	//if (!ParticleA->GetPinned() && !ParticleB->GetPinned())
	//{
	//	ParticleA->AddForce(halfForce);
	//	ParticleB->AddForce(-halfForce);
	//}
	//else if (!ParticleA->GetPinned())
	//{
	//	ParticleA->AddForce(force);
	//}
	//else if (!ParticleB->GetPinned())
	//{
	//	ParticleB->AddForce(-force);
	//}
}

bool ClothConstraint::GetInterwoven()
{
	return IsInterwoven;
}

void ClothConstraint::SetInterwoven(bool _interwoven)
{
	IsInterwoven = _interwoven;
}

void ClothConstraint::DisableConstraint()
{
	ParticleA->RemoveConstraint(this);
	ParticleB->RemoveConstraint(this);

	IsEnabled = false;
}

bool ClothConstraint::GetEnabled()
{
	return IsEnabled;
}

void ClothConstraint::SetEnabled(bool _enabled)
{
	IsEnabled = _enabled;
}

void ClothConstraint::TakeDamage(float _Damage)
{
	Health -= _Damage;
}
