// Fill out your copyright notice in the Description page of Project Settings.

#pragma once

#include "CoreMinimal.h"

/**
 *
 */
class ClothParticle;

class CLOTHSIMULATION_API ClothConstraint
{
public:
    ClothConstraint(ClothParticle* _particleA, ClothParticle* _particleB);
    ~ClothConstraint();

    void Update(float _DeltaTime);

    bool GetInterwoven();
    void SetInterwoven(bool _interwoven);

    void DisableConstraint();

    bool GetEnabled();
	void SetEnabled(bool _enabled);

    void TakeDamage(float _Damage);

private:
    ClothParticle* ParticleA = nullptr;
    ClothParticle* ParticleB = nullptr;

    float RestDistance;
    float Health = 20.0f;

    float MaxStrain = 7.0f;
    float DamageScale = 10.0f;

    bool IsInterwoven = false;
    
    bool IsEnabled = true;

   
};