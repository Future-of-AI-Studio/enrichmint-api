import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MODEL_THROTTLE } from 'src/common/constants/rate-limit.constants';
import { CurrentUser, Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import {
  DraftFieldNoteDto,
  HideFieldNoteDto,
  PublishFieldNoteDto,
  UpdateFieldNoteDto,
} from './dto/field-note.dto';
import { FieldNotesService } from './field-notes.service';

@ApiTags('Field notes')
@Controller()
export class FieldNotesController {
  constructor(private readonly notes: FieldNotesService) {}

  @Get('guides/:guideId/field-notes')
  @ApiOperation({
    summary:
      'Public: what learners reported after trying this guide (self-reported)',
  })
  forGuide(@Param('guideId') guideId: string) {
    return this.notes.forGuide(guideId);
  }

  @Post('field-notes/draft')
  @UseGuards(AuthGuard)
  @Throttle(MODEL_THROTTLE)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Learner: draft a field note from my follow-up feedback (AI-assisted; nothing is published)',
  })
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DraftFieldNoteDto,
  ) {
    return this.notes.draft(user.id, dto);
  }

  @Get('field-notes/mine')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Learner: my field note for one guide or response' })
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: DraftFieldNoteDto,
  ) {
    // Wrapped so "no note yet" is an explicit null rather than an empty body.
    return { note: await this.notes.mine(user.id, dto.source, dto.sourceId) };
  }

  @Patch('field-notes/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Learner: edit my draft field note' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFieldNoteDto,
  ) {
    return this.notes.update(user.id, id, dto.body);
  }

  @Post('field-notes/:id/publish')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Learner: publish my field note (needs approved: true); I then earn a share of later sales of the guide',
  })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PublishFieldNoteDto,
  ) {
    return this.notes.publish(user.id, id, dto);
  }

  @Get('admin/field-notes')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: published and hidden field notes' })
  listForAdmin() {
    return this.notes.listForAdmin();
  }

  @Post('admin/field-notes/:id/hide')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Admin: hide a field note' })
  hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: HideFieldNoteDto,
  ) {
    return this.notes.hide(user.id, id, dto.reason);
  }
}
