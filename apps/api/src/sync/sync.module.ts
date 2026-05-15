import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncRun } from './sync-run.entity';
import { SyncService } from './sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([SyncRun])],
  providers: [SyncService],
  exports: [SyncService, TypeOrmModule],
})
export class SyncModule {}
