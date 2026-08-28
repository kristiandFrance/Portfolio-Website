// Fill out your copyright notice in the Description page of Project Settings.

#pragma once

#include "CoreMinimal.h"

/**
 *
 */
class ClothConstraint;
class AClothSphere;

class CLOTHSIMULATION_API ClothParticle
{
public:
    ClothParticle(FVector _position);
    ~ClothParticle();

    void AddConstraint(ClothConstraint* _constraint);

    bool SharesConstraint(ClothParticle* _otherParticle);

    bool GetPinned();
    void SetPinned(bool _isPinned);

    TArray<class ClothConstraint*> GetConstraints();

    FVector GetPosition();
	void SetPosition(FVector _position);

    void OffsetPosition(FVector _offset);

    void AddForce(FVector _force);

    void Update(float _DeltaTime);

    void CheckForGroundCollision(float _groundHeight);
    void CheckForSphereCollision(AClothSphere* _clothSphere, FVector ClothPosition);

	void AddBurn(float _burnAmount);
	float GetBurnAmount();

	void RemoveConstraint(ClothConstraint* _constraint);

private:

    float PreviousDeltaTime = -1.0f;

    FVector Position = { 0, 0, 0 };
    FVector PreviousPosition = { 0, 0, 0 };

	FVector Velocity = { 0, 0, 0 };

	FVector Acceleration = { 0, 0, 0 };

    TArray<ClothConstraint*> Constraints;
    
    bool IsPinned = false;
    float Damping = 0.0005f;

    bool OnGround = false;

    float BurnAmount = 0.0f;
	float BurnRate = 0.1f;

};